import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { BrowserContext, Page } from "playwright-core";
import {
  BANK,
  BASE,
  expect,
  launch,
  newContextWithShim,
  passOnboarding,
  report,
  seen,
  STEP_TIMEOUT,
  waitForDeploy,
  type Problem,
} from "./browser.js";

/**
 * 접근성을 **실제 브라우저에서** 잰다.
 *
 * <p>컴포넌트 테스트의 axe는 `color-contrast`와 `target-size`를 꺼 두고 있다.
 * 이유는 정당했다 — `packages/react/test/MinUIHome.test.tsx`가 적어 둔 대로
 * <b>"jsdom은 CSS를 계산하지 않으므로 색 대비와 크기 규칙은 axe로 잴 수 없다."</b>
 *
 * <p>그런데 이 프로젝트의 핵심 가치가 접근성이다. 두 규칙을 "테스트 환경 한계"로 오래
 * 남겨 두면, 정작 가장 중요한 것에 근거가 없다. <b>여기서는 켠다.</b> 실제로 그려진
 * 픽셀이 있으므로 잴 수 있다.
 *
 * <p>표준 규칙(axe)만 보지 않는다. 이 프로젝트는 스스로 더 높은 기준을 정해 뒀다 —
 * 터치 영역 <b>88×88</b>(WCAG 권고보다 크다. 손떨림을 고려한 값), 그리고 고령 사용자가
 * 실제로 겪는 조건들: 좁은 화면, 200% 확대, 키보드만, 마이크가 없는 브라우저.
 *
 * <pre>
 *   pnpm --filter @minui/smoke a11y
 *   SMOKE_BASE_URL=http://localhost:5174/ pnpm --filter @minui/smoke a11y
 * </pre>
 */

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** 이 저장소가 스스로 정한 값. WCAG 권고치보다 크다 (기획안 §11.3). */
const TOUCH_MIN = 88;

/**
 * 서브픽셀은 봐준다. **레이아웃 반올림이지 부족이 아니다.**
 *
 * <p>`min-height: 88px`인 버튼을 실제로 재면 `87.99996948242188`이 나온다. 그런데 표시는
 * 반올림해서 "88×88"이라, 검사가 <b>"88×88은 88보다 작다"</b>는 스스로 모순된 말을 했다.
 * 어디를 고쳐야 하는지 알 수 없는 실패는 없느니만 못하다.
 *
 * <p>0.5px로 잡은 것은 그보다 크게 잡으면 진짜 부족을 놓치기 때문이다. 전에 이 검사가
 * 실제로 잡아낸 고정 버튼은 87×88이었고, 그것은 지금도 걸린다.
 */
const SUBPIXEL = 0.5;

interface AxeViolation {
  id: string;
  impact?: string;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
}

/**
 * 그 화면에 axe를 돌린다. **꺼 두던 두 규칙을 켠 채로.**
 *
 * @param only 그 순간 열려 있는 부분만 볼 때 (시트·화면). 없으면 문서 전체.
 */
async function runAxe(page: Page, only?: string): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (selector) => {
    const context = selector ? { include: [[selector]] } : document;
    const results = await (
      window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }
    ).axe.run(context, {
      // **여기가 요점이다.** jsdom에서 끄던 둘을 켠다.
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    });
    return (results as { violations: AxeViolation[] }).violations;
  }, only);
}

function noteViolations(violations: AxeViolation[], where: string, problems: Problem[]): void {
  for (const violation of violations) {
    const targets = violation.nodes
      .slice(0, 3)
      .map((node) => node.target.join(" "))
      .join(" · ");
    problems.push({
      kind: "a11y",
      detail: `${where} — ${violation.id} (${violation.impact ?? "?"}) ${violation.help} → ${targets}`,
    });
  }
}

/** 화면 밖으로 나갔거나, 손가락으로 누르기엔 작은 것. */
async function measureLayout(page: Page): Promise<{
  overflow: boolean;
  documentWidth: number;
  viewport: number;
  clipped: string[];
  small: string[];
  excluded: number;
}> {
  return page.evaluate((touchMin) => {
    const doc = document.documentElement;
    const clipped: string[] = [];
    const small: string[] = [];
    let excluded = 0;

    const label = (el: Element) => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
      return `${el.tagName.toLowerCase()}${text ? `("${text}")` : ""}`;
    };

    for (const el of document.querySelectorAll("button, a[href], select, input, [role=button]")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // 안 보이는 것은 안 센다
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;

      if (rect.right > doc.clientWidth + 1 || rect.left < -1) clipped.push(label(el));

      /*
       * 인라인 링크는 글 안에 있어 이 기준을 적용하지 않는다 — 문단 가운데 링크를
       * 88px로 만들면 글이 읽히지 않는다. 누르라고 만든 것만 본다.
       */
      /*
       * 진행자용 데모 크롬은 이 기준에서 뺀다 — 모드 전환과 가상 원장 초기화는
       * MinUI가 얹히는 화면이 아니라 이 데모에만 있는 대조·초기화 장치다.
       * **다만 몇 개를 뺐는지 반드시 찍는다.** 조용히 빼면 처음 상태로 돌아간다.
       */
      if (el.closest("[data-demo-chrome]")) {
        excluded += 1;
        continue;
      }

      const inlineLink = el.tagName === "A" && style.display === "inline";
      if (!inlineLink && Math.min(rect.width, rect.height) < touchMin) {
        // 반올림하지 않는다. 87.99를 "88"로 찍으면 실패 메시지가 스스로를 부정한다.
        const size = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
        small.push(`${label(el)} ${size(rect.width)}×${size(rect.height)}`);
      }
    }

    return {
      overflow: doc.scrollWidth > doc.clientWidth + 1,
      documentWidth: doc.scrollWidth,
      viewport: doc.clientWidth,
      clipped,
      small,
      excluded,
    };
  }, TOUCH_MIN - SUBPIXEL);
}

// ── 검사 ──────────────────────────────────────────────────────────────────

interface Check {
  name: string;
  run: (context: BrowserContext, problems: Problem[]) => Promise<void>;
}

const VIEWPORTS = [
  { name: "좁은 폰", width: 360, height: 740 },
  { name: "태블릿", width: 768, height: 1024 },
  { name: "데스크톱", width: 1280, height: 900 },
];

const CHECKS: Check[] = [
  {
    name: "① 세 폭에서 가로 스크롤도, 잘린 버튼도 없다",
    run: async (context, problems) => {
      for (const viewport of VIEWPORTS) {
        const page = await context.newPage();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const url of [BASE, BANK]) {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
          await passOnboarding(page);
          const layout = await measureLayout(page);
          const where = `${viewport.name}(${viewport.width}px) ${url}`;
          expect(
            !layout.overflow,
            `${where} — 가로 스크롤 (문서 ${layout.documentWidth} > 화면 ${layout.viewport})`,
            problems,
          );
          expect(
            layout.clipped.length === 0,
            `${where} — 화면 밖으로 잘린 것: ${layout.clipped.slice(0, 4).join(", ")}`,
            problems,
          );
        }
        await page.close();
      }
    },
  },

  {
    name: `② 누를 것이 ${TOUCH_MIN}px 이상이다 (이 저장소가 정한 값)`,
    run: async (context, problems) => {
      const page = await context.newPage();
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(BANK, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
      await passOnboarding(page);

      const home = await measureLayout(page);
      expect(
        home.small.length === 0,
        `홈에서 작은 것: ${home.small.slice(0, 5).join(" · ")}`,
        problems,
      );
      console.log(
        `      홈: ${TOUCH_MIN}px 기준으로 쟀고, 진행자용 크롬 ${home.excluded}개는 뺐습니다`,
      );

      await page.getByRole("button", { name: /전체 메뉴/ }).click();
      await seen(page.getByRole("dialog"));
      const sheet = await measureLayout(page);
      expect(
        sheet.small.length === 0,
        `전체 메뉴에서 작은 것: ${sheet.small.slice(0, 5).join(" · ")}`,
        problems,
      );
      await page.close();
    },
  },

  {
    name: "③ axe — 색 대비와 터치 크기를 **켜고** 잰다",
    run: async (context, problems) => {
      const page = await context.newPage();
      await page.setViewportSize({ width: 390, height: 844 });

      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
      noteViolations(await runAxe(page), "루트", problems);

      await page.goto(BANK, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
      noteViolations(await runAxe(page), "은행 시연(온보딩)", problems);

      await passOnboarding(page);
      noteViolations(await runAxe(page), "은행 시연(홈)", problems);

      await page.getByRole("button", { name: /전체 메뉴/ }).click();
      await seen(page.getByRole("dialog"));
      noteViolations(await runAxe(page, "[role=dialog]"), "전체 메뉴", problems);

      await page.getByRole("dialog").getByRole("button", { name: /^계좌 이체$/ }).click();
      await seen(page.getByRole("dialog", { name: "계좌 이체" }));
      noteViolations(await runAxe(page, "[role=dialog]"), "이체 화면", problems);

      await page.close();
    },
  },

  {
    name: "④ 200% 확대에서도 핵심 경로가 된다",
    run: async (context, problems) => {
      /*
       * 200% 확대는 **CSS 픽셀이 절반**이 되는 것과 같다. 1280×1024를 200%로 보면
       * 640×512가 된다. 그 폭에서 모드 전환·검색·이체 확인이 되는지 본다 (WCAG 1.4.4).
       */
      const page = await context.newPage();
      await page.setViewportSize({ width: 640, height: 512 });
      await page.goto(BANK, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
      await passOnboarding(page);

      const layout = await measureLayout(page);
      expect(!layout.overflow, "200% 확대에서 가로 스크롤이 생긴다", problems);

      expect(
        await seen(page.getByRole("button", { name: "기본 UI" })),
        "200% 확대에서 모드 전환이 안 보인다",
        problems,
      );

      await page.getByRole("button", { name: /말로 찾기/ }).click();
      expect(
        await seen(page.getByPlaceholder(/자동이체/)),
        "200% 확대에서 글로 찾기 칸에 닿지 못한다",
        problems,
      );
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /전체 메뉴/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: /^계좌 이체$/ }).click();
      expect(
        await seen(page.getByRole("dialog", { name: "계좌 이체" }).getByRole("button", { name: "보내기" })),
        "200% 확대에서 이체 확인 버튼에 닿지 못한다",
        problems,
      );
      await page.close();
    },
  },

  {
    name: "⑤ 키보드만으로 열고, 닫고, 이체 화면까지 간다",
    run: async (context, problems) => {
      const page = await context.newPage();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(BANK, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
      await passOnboarding(page);

      /** Tab을 눌러 그 이름의 버튼에 초점이 갈 때까지. 못 가면 거짓. */
      async function tabTo(pattern: RegExp, limit = 40): Promise<boolean> {
        for (let i = 0; i < limit; i += 1) {
          await page.keyboard.press("Tab");
          const label = await page.evaluate(
            () => (document.activeElement?.textContent ?? "").replace(/\s+/g, " ").trim(),
          );
          if (pattern.test(label)) return true;
        }
        return false;
      }

      expect(await tabTo(/전체 메뉴/), "Tab만으로 전체 메뉴에 초점이 안 간다", problems);

      // 초점이 보이는가. 안 보이면 키보드 사용자는 자기가 어디 있는지 모른다.
      const focusVisible = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return false;
        const style = getComputedStyle(el);
        return (
          style.outlineStyle !== "none" ||
          style.boxShadow !== "none" ||
          el.matches(":focus-visible")
        );
      });
      expect(focusVisible, "초점이 눈에 보이지 않는다", problems);

      await page.keyboard.press("Enter");
      expect(await seen(page.getByRole("dialog")), "Enter로 전체 메뉴가 안 열린다", problems);

      await page.keyboard.press("Escape");
      expect(
        !(await seen(page.getByRole("dialog"), 1_500)),
        "Escape로 시트가 안 닫힌다",
        problems,
      );
      await page.close();
    },
  },

  {
    name: "⑥ 음성이 없는 브라우저에서도 같은 메뉴에 닿는다",
    run: async (context, problems) => {
      const page = await context.newPage();
      // Web Speech를 지우고 연다. 파이어폭스나 권한을 거절한 상태와 같다.
      await page.addInitScript(() => {
        // @ts-expect-error — 브라우저 전역을 지우는 것이 이 검사의 전부다.
        delete window.SpeechRecognition;
        // @ts-expect-error — 벤더 접두사 쪽도 함께.
        delete window.webkitSpeechRecognition;
      });
      await page.goto(BANK, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
      await passOnboarding(page);

      await page.getByRole("button", { name: /말로 찾기/ }).click();

      expect(
        !(await seen(page.getByRole("button", { name: /눌러서 말하기/ }), 1_500)),
        "음성을 못 쓰는데 마이크 버튼이 떠 있다",
        problems,
      );

      const box = page.getByPlaceholder(/자동이체/);
      expect(await seen(box), "음성이 없을 때 글로 찾기 칸이 없다", problems);

      await box.fill("자동이체");
      await page.getByRole("button", { name: "찾기", exact: true }).click();
      expect(
        await seen(page.getByRole("button", { name: /자동이체 관리/ })),
        "글로 찾았는데 메뉴에 닿지 못한다 — 음성 없이는 못 쓰는 앱이 된다",
        problems,
      );
      await page.close();
    },
  },
];

// ── 실행 ──────────────────────────────────────────────────────────────────

console.log(`\n  접근성 — 대상 ${BASE}\n`);
await waitForDeploy();

const browser = await launch();
let failed = 0;

for (const check of CHECKS) {
  // 검사마다 새 문맥. 앞 검사의 저장소·확대가 남으면 다음이 거짓으로 통과한다.
  const context = await newContextWithShim(browser);
  const problems: Problem[] = [];
  try {
    await check.run(context, problems);
  } catch (error) {
    problems.push({
      kind: "assert",
      detail: error instanceof Error ? error.message.split("\n")[0]! : String(error),
    });
  } finally {
    await context.close();
  }
  if (report(check.name, problems)) failed += 1;
}

await browser.close();

if (failed > 0) {
  console.error(`\n  실패 ${failed}건 — 대상 ${BASE}\n`);
  process.exitCode = 1;
} else {
  console.log(`\n  ${CHECKS.length}개 검사 통과 — ${BASE}`);
  console.log(`  색 대비와 터치 크기를 **끄지 않고** 쟀습니다.\n`);
}
