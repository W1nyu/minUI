import type { Browser, Page } from "playwright-core";
import { BANK, BASE, launch, newContextWithShim, STEP_TIMEOUT, waitForDeploy } from "./browser.js";

/**
 * **예산을 정하고 재는 자리.** 최적화하는 자리가 아니다.
 *
 * <p>데모 빌드에 "청크가 크다" 경고가 있다. 그런데 그것만 보고 `dynamic import`를 뿌리면
 * 첫 화면이 오히려 늦어질 수 있다 — 쪼갠 조각은 <b>따로 왕복</b>하고, 시연에서 제일 먼저
 * 눈에 띄는 것이 그 왕복이다. 그래서 순서를 뒤집는다. <b>예산을 넘긴 것만 쪼갠다.</b>
 *
 * <p>재는 곳은 배포된 주소다. 로컬 `dist`의 파일 크기는 전송량이 아니다 — Pages는
 * gzip으로 보내고 실제로 도착하는 양은 몇 배 작다. 그 차이를 모르고 쪼개면 없는 문제를
 * 고치게 된다.
 *
 * <p><b>모바일을 흉내 낸다.</b> 이 데모를 쓰는 사람은 어르신의 폰이지 개발 기계의
 * 광랜과 8코어가 아니다. CPU 4배 감속 + 4G 지연은 Lighthouse 모바일과 같은 방식이다.
 * 절대값이 아니라 <b>같은 조건에서의 전후 비교</b>로 쓰라고 있는 숫자다.
 *
 * <pre>
 *   pnpm --filter @minui/smoke perf
 *   SMOKE_BASE_URL=http://localhost:5174/ pnpm --filter @minui/smoke perf
 * </pre>
 */

/**
 * 예산. **넘으면 실패한다.**
 *
 * <p>근거를 같이 적는다. 숫자만 있으면 다음 사람이 넘겼을 때 "조금 넘었네" 하고 올린다.
 */
interface Budget {
  /** 첫 화면에 실제로 도착하는 JS(gzip 후). */
  jsBytes: number;
  /** Largest Contentful Paint. */
  lcpMs: number;
  /** 그 화면의 <b>주된 버튼</b>을 실제로 누를 수 있을 때까지. */
  readyMs: number;
}

interface Target {
  name: string;
  url: string;
  /** 이 화면이 "준비됐다"의 정의. 이게 눌려야 시연이 시작된다. */
  ready: (page: Page) => Promise<void>;
  budget: Budget;
  why: string;
}

const TARGETS: Target[] = [
  {
    name: "루트 — 이식 데모",
    url: BASE,
    ready: async (page) =>
      page
        .getByRole("link", { name: /가상 이체 시연/ })
        .waitFor({ state: "visible", timeout: STEP_TIMEOUT }),
    // 심사위원이 처음 여는 화면. 금융사 카탈로그가 여기 실린다.
    budget: { jsBytes: 320_000, lcpMs: 3_000, readyMs: 4_000 },
    why: "첫인상. 여기서 멈춰 보이면 나머지를 안 본다",
  },
  {
    name: "미니은행 — 주인공",
    url: BANK,
    ready: async (page) =>
      page
        .getByRole("button", { name: /돈을 보내요/ })
        .waitFor({ state: "visible", timeout: STEP_TIMEOUT }),
    // 어르신이 실제로 쓰는 화면. 루트보다 엄하게 잡는다.
    budget: { jsBytes: 150_000, lcpMs: 2_500, readyMs: 3_000 },
    why: "이 프로젝트가 하려는 일이 전부 여기서 일어난다",
  },
];

/**
 * 손이 닿은 뒤 화면이 답할 때까지. **이건 크기가 아니라 감각의 문제다.**
 *
 * <p>어르신이 버튼을 누르고 "눌린 건가?" 하며 다시 누르면 그 화면은 진 것이다.
 * 예산 1초는 사람이 "즉시"라고 느끼는 경계에서 왔다.
 */
const TAP_BUDGET_MS = 1_000;

/** 어르신 폰 흉내. 세 곳에서 같은 조건을 써야 비교가 성립한다. */
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;

interface Measured {
  jsBytes: number;
  totalBytes: number;
  requests: number;
  lcpMs: number | null;
  readyMs: number;
}

/** 브라우저가 스스로 잰 것을 그대로 가져온다. 내가 초를 재면 오차가 섞인다. */
async function readTiming(page: Page): Promise<Omit<Measured, "readyMs">> {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    /*
     * `transferSize`가 실제로 회선을 지나간 양이다(gzip 후 + 헤더). 0이면 캐시에서
     * 온 것 — 새 문맥이라 여기서는 안 나오지만, 나오면 `encodedBodySize`로 받는다.
     */
    const wire = (r: PerformanceResourceTiming) => r.transferSize || r.encodedBodySize;
    const js = resources.filter((r) => /\.js(\?|$)/.test(r.name));

    const lcp = new Promise<number | null>((resolve) => {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        resolve(entries.length ? entries[entries.length - 1]!.startTime : null);
      }).observe({ type: "largest-contentful-paint", buffered: true });
      // 관찰자가 아무것도 못 받는 화면도 있다. 그때는 없다고 답한다 — 0으로 속이지 않는다.
      setTimeout(() => resolve(null), 1_500);
    });

    return lcp.then((lcpMs) => ({
      jsBytes: js.reduce((sum, r) => sum + wire(r), 0),
      totalBytes: resources.reduce((sum, r) => sum + wire(r), 0),
      requests: resources.length,
      lcpMs,
    }));
  });
}

/** CPU와 회선을 함께 죈다. 하나만 죄면 실제 폰과 다른 것을 재게 된다. */
async function throttle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

async function measure(browser: Browser, target: Target): Promise<Measured> {
  // 매번 새 문맥. 캐시가 남으면 두 번째부터 전송량이 0이 되어 아무것도 못 잰다.
  const context = await newContextWithShim(browser, { ...PHONE });
  const page = await context.newPage();
  try {
    await throttle(page);
    const started = Date.now();
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT * 2 });
    await target.ready(page);
    const readyMs = Date.now() - started;
    return { ...(await readTiming(page)), readyMs };
  } finally {
    await context.close();
  }
}

/**
 * 미니은행에서 **손이 닿는 세 곳**을 잰다.
 *
 * <p>내려받는 양과는 다른 이야기다. 번들이 작아도 화면이 굼뜨면 소용이 없고, 시연에서
 * 사람이 실제로 느끼는 것은 이쪽이다.
 */
async function measureTaps(browser: Browser): Promise<{ name: string; ms: number }[]> {
  const context = await newContextWithShim(browser, { ...PHONE });
  const page = await context.newPage();
  const taps: { name: string; ms: number }[] = [];
  try {
    await throttle(page);
    await page.goto(BANK, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT * 2 });

    let at = Date.now();
    await page.getByRole("button", { name: /돈을 보내요/ }).click();
    await page.getByRole("button", { name: /^보통$/ }).click();
    await page.getByRole("button", { name: /말로 찾기/ }).waitFor({ state: "visible" });
    taps.push({ name: "온보딩 2문항 → 홈", ms: Date.now() - at });

    at = Date.now();
    await page.getByRole("button", { name: /전체 메뉴/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^계좌 이체$/ })
      .waitFor({ state: "visible" });
    taps.push({ name: "전체 메뉴 → 목록", ms: Date.now() - at });

    await page.keyboard.press("Escape");

    at = Date.now();
    await page.getByRole("button", { name: /말로 찾기/ }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    taps.push({ name: "말로 찾기 → 시트", ms: Date.now() - at });

    return taps;
  } finally {
    await context.close();
  }
}

const kb = (n: number): string => `${(n / 1024).toFixed(0)}KB`;
const verdict = (actual: number, budget: number): string => (actual <= budget ? "✓" : "✗");

async function main(): Promise<void> {
  console.log(`성능 예산 — ${BASE}`);
  console.log("모바일 흉내: CPU 4배 감속 · 1.6Mbps · 지연 150ms (Lighthouse 모바일과 같은 방식)\n");
  await waitForDeploy();

  const browser = await launch();
  let over = 0;
  try {
    for (const target of TARGETS) {
      const m = await measure(browser, target);
      const b = target.budget;
      console.log(`  ${target.name}`);
      console.log(`    ${target.why}`);
      console.log(
        `    ${verdict(m.jsBytes, b.jsBytes)} JS 전송 ${kb(m.jsBytes)} / 예산 ${kb(b.jsBytes)}` +
          `   (전체 ${kb(m.totalBytes)}, 요청 ${m.requests}개)`,
      );
      console.log(
        m.lcpMs === null
          ? "    ? LCP 못 쟀다 — 관찰자가 아무것도 못 받았다"
          : `    ${verdict(m.lcpMs, b.lcpMs)} LCP ${m.lcpMs.toFixed(0)}ms / 예산 ${b.lcpMs}ms`,
      );
      console.log(
        `    ${verdict(m.readyMs, b.readyMs)} 주 버튼까지 ${m.readyMs}ms / 예산 ${b.readyMs}ms\n`,
      );

      if (m.jsBytes > b.jsBytes) over += 1;
      if (m.lcpMs !== null && m.lcpMs > b.lcpMs) over += 1;
      if (m.readyMs > b.readyMs) over += 1;
    }

    console.log("  손이 닿은 뒤 답할 때까지");
    for (const tap of await measureTaps(browser)) {
      console.log(
        `    ${verdict(tap.ms, TAP_BUDGET_MS)} ${tap.name} ${tap.ms}ms / 예산 ${TAP_BUDGET_MS}ms`,
      );
      if (tap.ms > TAP_BUDGET_MS) over += 1;
    }
  } finally {
    await browser.close();
  }

  console.log(
    over === 0
      ? "\n예산 안이다. **지금은 번들을 쪼개지 않는다** — 쪼개면 왕복이 늘어 첫 화면이 더 늦어진다."
      : `\n${over}칸이 예산을 넘었다. 넘은 칸만, 그 칸이 늦은 이유대로 고친다.`,
  );
  process.exitCode = over === 0 ? 0 : 1;
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
