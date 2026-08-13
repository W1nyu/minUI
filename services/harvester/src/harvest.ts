import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import {
  clickTriggerInPage,
  countLinksInPage,
  extractInPage,
  findTriggersInPage,
  type ExtractResult,
  type RawLink,
} from "./extract.js";
import { checkUrl, parseRobots, robotsAllows } from "./guard.js";
import { deriveKey, isSameSite } from "./keys.js";

/**
 * URL 하나 → 수집 원본(`raw.json`).
 *
 * <p>출력 형식은 손으로 수집하던 것과 <b>글자 하나 다르지 않다.</b> 그래야
 * `tools/src/build-catalog.ts`의 검증(개인정보 필터·id 규칙·라벨 정리)을 그대로 통과하고,
 * 손 수집본과 대조해 회수율을 잴 수 있다.
 */

export interface RawItem {
  path: string[];
  label: string;
  key: string;
}

export interface RawFile {
  source: {
    site: string;
    host: string;
    capturedAt: string;
    note?: string;
  };
  items: RawItem[];
}

export interface HarvestOptions {
  url: string;
  /** 카탈로그 파일명이 될 이름. 생략하면 호스트에서 만든다. */
  site?: string;
  /** 페이지가 무거워 오래 걸리는 곳이 있다. 기본 45초. */
  timeoutMs?: number;
  /** 설치된 Chrome을 쓴다. 브라우저를 따로 내려받지 않기 위한 기본값. */
  channel?: string;
  /** 진행 상황. Studio 화면이 그대로 받아 쓴다. */
  onProgress?: (stage: string, detail?: string) => void;
  /**
   * robots.txt를 무시할 것인가. **기본은 지킨다.**
   * 사이트 소유자가 자기 사이트를 올리는 경우에만 켠다.
   */
  ignoreRobots?: boolean;
}

export interface HarvestResult extends RawFile {
  /** 어떻게 찾았는지. 회수율이 낮을 때 어디를 고칠지 알려 준다. */
  diagnostics: {
    strategy: string;
    trigger: string;
    frame: string;
    /** 후보 그릇들의 점수. 잘못 골랐는지 눈으로 확인할 수 있게 남긴다. */
    considered: ExtractResult["considered"];
    /** 걸러 낸 것들 — 외부 링크, 빈 라벨, 중복 */
    dropped: { external: number; empty: number; duplicate: number };
    elapsedMs: number;
  };
}

/** 호스트에서 카탈로그 이름을 만든다. `www.kebhana.com` → `kebhana`. */
export function siteNameFrom(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts[0] ?? host;
}

export async function harvest(options: HarvestOptions): Promise<HarvestResult> {
  const started = Date.now();
  const report = options.onProgress ?? (() => {});
  const timeout = options.timeoutMs ?? 45_000;

  const checked = checkUrl(options.url);
  if (!checked.ok || !checked.url) throw new Error(checked.reason ?? "열 수 없는 주소입니다.");

  const url = checked.url;
  const parsed = new URL(url);
  const host = parsed.host;
  const site = options.site ?? siteNameFrom(host);

  report("browser", "브라우저를 여는 중");
  const browser = await launch(options.channel);

  try {
    const page = await browser.newPage({
      // 봇 취급을 덜 받도록 평범한 데스크톱 환경을 흉내 낸다. 우회가 아니라,
      // 기본 헤드리스 값이 실제 사용자와 너무 달라 레이아웃이 달라지는 것을 막는 것이다.
      viewport: { width: 1440, height: 900 },
      locale: "ko-KR",
    });
    page.setDefaultTimeout(timeout);

    if (options.ignoreRobots !== true) {
      report("robots", "robots.txt 확인");
      const verdict = await checkRobots(page, parsed, timeout);
      if (!verdict.allowed) {
        throw new Error(
          `이 사이트의 robots.txt가 ${parsed.pathname} 수집을 막고 있습니다. ` +
            "사이트 소유자라면 ignoreRobots로 넘길 수 있습니다.",
        );
      }
    }

    report("load", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await settle(page, timeout);

    report("open", "전체메뉴를 여는 중");
    const trigger = await openAllMenu(page, report);

    report("extract", "메뉴를 읽는 중");
    const extracted = await extractBest(page, report);

    const { items, dropped } = toItems(extracted.links, host);

    report("done", `메뉴 ${items.length}개`);

    return {
      source: {
        site,
        host,
        capturedAt: new Date().toISOString(),
        note: `자동 수집. 전략=${extracted.strategy}${extracted.frame ? ` 프레임=${extracted.frame}` : ""}. 로그인하지 않은 상태에서 내비게이션만 읽음.`,
      },
      items,
      diagnostics: {
        strategy: extracted.strategy,
        trigger,
        frame: extracted.frame,
        considered: extracted.considered,
        dropped,
        elapsedMs: Date.now() - started,
      },
    };
  } finally {
    await browser.close();
  }
}

/**
 * 최상위 문서에서 못 찾으면 **프레임 안을 본다.**
 *
 * <p>미래에셋증권이 프레임셋이었다. 최상위 문서에 링크가 0개고 본문이
 * `window.frames[1]`에 있다. 이것을 모르면 그 사이트는 수집 자체가 안 된다.
 */
async function extractBest(
  page: Page,
  report: NonNullable<HarvestOptions["onProgress"]>,
): Promise<ExtractResult & { frame: string }> {
  await installNameShim(page);
  const top = await page.evaluate(extractInPage);
  let best: ExtractResult & { frame: string } = { ...top, frame: "" };

  /*
   * 프레임을 훑는다. 미래에셋증권이 프레임셋이라 최상위 문서에는 링크가 0개고
   * 본문이 `main.do` 프레임에 있다.
   *
   * **먼저 읽고 나중에 누른다.** 반대로 하면 클릭이 프레임을 갈아치우면서 실행 컨텍스트가
   * 날아가고, 그 뒤의 추출이 통째로 실패한다. 실제로 415개짜리 프레임에서 0개를 가져왔다.
   */
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    await installNameShim(frame);

    const before = await frame.evaluate(extractInPage).catch(() => null);
    if (before && before.links.length > best.links.length) {
      best = { ...before, frame: frame.url() };
    }

    const url = frame.url();
    const opened = await openAllMenu(frame, report).catch(() => "");
    if (!opened) continue;

    // 클릭 뒤에는 프레임 참조가 낡았을 수 있다. URL로 다시 찾는다.
    const fresh = page.frames().find((f) => f.url() === url) ?? frame;
    await installNameShim(fresh);
    const after = await fresh.evaluate(extractInPage).catch(() => null);
    if (after && after.links.length > best.links.length) {
      best = { ...after, frame: fresh.url() };
    }
  }
  return best;
}

/**
 * 전체메뉴를 연다. **누른 뒤 링크가 늘었는지 확인하고, 안 늘면 다음 후보로 넘어간다.**
 *
 * <p>신한은행에서 "전체메뉴 닫기"를 눌러 패널을 접는 바람에 1,004개짜리 메뉴가 99개로
 * 수집됐다. 이름만 보고 고르면 그런 일이 난다. 여는 것과 닫는 것은 **결과로만 구별된다.**
 */
async function openAllMenu(
  target: Page | Frame,
  report: NonNullable<HarvestOptions["onProgress"]>,
): Promise<string> {
  await installNameShim(target);
  const triggers = await target.evaluate(findTriggersInPage).catch(() => []);
  if (triggers.length === 0) return "";

  const before = await target.evaluate(countLinksInPage).catch(() => 0);

  for (const trigger of triggers.slice(0, 6)) {
    const clicked = await target
      .evaluate(clickTriggerInPage, trigger.index)
      .catch(() => false);
    if (!clicked) continue;

    await target.waitForTimeout(1200);
    const after = await target.evaluate(countLinksInPage).catch(() => before);

    // 10% 이상 늘었으면 무언가를 편 것이다. 그대로 두고 끝낸다.
    if (after > before * 1.1) {
      report("open", `"${trigger.label}" → 링크 ${before} → ${after}`);
      return trigger.label;
    }
  }

  // 아무것도 늘지 않았다. 이미 펼쳐져 있거나(하나은행), 클릭이 필요 없는 사이트다.
  return "";
}

/** 수집한 링크를 `raw.json`의 항목으로. 여기서부터는 순수 로직이다. */
export function toItems(
  links: readonly RawLink[],
  host: string,
): { items: RawItem[]; dropped: HarvestResult["diagnostics"]["dropped"] } {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  const dropped = { external: 0, empty: 0, duplicate: 0 };

  for (const link of links) {
    const label = link.label.replace(/\s+/g, " ").trim();
    if (label.length === 0) {
      dropped.empty += 1;
      continue;
    }
    if (link.href && !isSameSite(link.href, host)) {
      dropped.external += 1;
      continue;
    }

    const key = deriveKey({
      href: link.href,
      onclick: link.onclick,
      elementId: link.elementId,
      path: link.path,
      label,
    });

    // 같은 경로에 같은 이름이 두 번 나오는 것은 같은 링크다.
    const fingerprint = `${link.path.join(">")}|${label}|${key}`;
    if (seen.has(fingerprint)) {
      dropped.duplicate += 1;
      continue;
    }
    seen.add(fingerprint);

    items.push({ path: link.path, label, key });
  }

  return { items, dropped };
}

/**
 * robots.txt를 읽어 이 경로를 읽어도 되는지 본다.
 *
 * <p>브라우저로 가져온다. `fetch`를 따로 쓰면 쿠키·리다이렉트 처리가 달라져
 * 실제로 우리가 접속하는 것과 다른 것을 보게 된다.
 *
 * <p>robots.txt가 없거나(404) 읽지 못하면 **허용으로 본다.** 사이트가 아무 뜻도
 * 밝히지 않은 것을 금지로 읽을 근거는 없다.
 */
async function checkRobots(
  page: Page,
  target: URL,
  timeout: number,
): Promise<{ allowed: boolean }> {
  try {
    const response = await page.request.get(`${target.origin}/robots.txt`, {
      timeout: Math.min(timeout, 10_000),
    });
    if (!response.ok()) return { allowed: true };
    const rules = parseRobots(await response.text());
    return { allowed: robotsAllows(rules, target.pathname) };
  } catch {
    return { allowed: true };
  }
}

/**
 * 설치된 Chrome을 먼저 쓴다.
 *
 * <p>Playwright가 딸려 오는 Chromium을 내려받게 두면 150MB가 넘는다. 대부분의 개발
 * 환경에는 Chrome이 이미 있고, 실제 사이트가 보는 것도 그쪽이라 재현성도 낫다.
 * 없으면 번들 Chromium으로 물러난다.
 */
async function launch(channel = "chrome"): Promise<Browser> {
  try {
    return await chromium.launch({ channel, headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

/**
 * `__name` 껍데기를 페이지에 심는다.
 *
 * <p>`tsx`가 쓰는 esbuild는 함수 이름을 보존하려고 `__name(fn, "이름")` 호출을 끼워 넣는다.
 * 그 헬퍼는 <b>모듈 스코프에 정의되는데</b>, `page.evaluate`는 함수를 문자열로 만들어
 * 브라우저로 보내므로 헬퍼가 따라가지 않는다. 그래서 페이지 안에서 `__name is not defined`로
 * 죽는다. 빌드 설정을 바꾸는 대신 페이지 쪽에 빈 껍데기를 두는 편이 낫다 —
 * 이 코드가 어떤 번들러를 거치든 상관없어진다.
 *
 * <p>문자열로 넘기는 것이 요점이다. 함수로 넘기면 그것도 같은 변환을 받는다.
 */
async function installNameShim(target: Page | Frame): Promise<void> {
  await target
    .evaluate("globalThis.__name = globalThis.__name || function (fn) { return fn; };")
    .catch(() => {});
}

/** 스크립트로 메뉴를 그리는 사이트가 많다. 조용해질 때까지 기다리되 오래 붙잡지 않는다. */
async function settle(page: Page | Frame, timeout: number): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 15_000) }).catch(() => {
    // 광고·시세 스트림 때문에 영영 조용해지지 않는 사이트가 있다. 그래도 진행한다.
  });
}
