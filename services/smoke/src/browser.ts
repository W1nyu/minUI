import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";

/**
 * 배포본을 브라우저로 여는 데 필요한 공용 부분.
 *
 * <p>`smoke.ts`(동작)와 `a11y.ts`(접근성)가 같은 화면을 밟는다. 여는 방법이 갈라지면
 * 한쪽만 고쳐지고 다른 쪽이 조용히 다른 것을 재게 된다.
 */

export const BASE = (process.env["SMOKE_BASE_URL"] ?? "https://w1nyu.github.io/minUI/").replace(
  /\/?$/,
  "/",
);

export const BANK = new URL("bank/", BASE).href;

/** 한 단계가 걸릴 수 있는 최대 시간. 넘으면 그대로 실패다. */
export const STEP_TIMEOUT = 15_000;

export interface Problem {
  kind: "console" | "request" | "assert" | "a11y";
  detail: string;
}

export function expect(condition: unknown, message: string, problems: Problem[]): void {
  if (!condition) problems.push({ kind: "assert", detail: message });
}

/**
 * 이 요소가 실제로 뜨는가. **기다린다.**
 *
 * <p>`locator.isVisible()`은 기다리지 않고 그 순간을 답한다. React가 그리기 전에 물으면
 * 언제나 거짓이고, 그러면 "화면이 없다"고 말한다 — 실제로는 늦었을 뿐이다.
 */
export async function seen(locator: Locator, timeout = STEP_TIMEOUT): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

/**
 * 온보딩 2문항을 넘긴다. **새 문맥마다 뜬다 — 그것이 정상이다.**
 *
 * <p>홈이 실제로 떴는지까지 확인하고 돌려준다. 여기서 안 기다리면 다음 단계가 헛친다.
 */
/**
 * 로그인 문을 지난다.
 *
 * <p>미니은행이 「누구로 볼까요?」로 시작하게 되면서 생긴 단계다. <b>비밀번호를 확인하지
 * 않으므로</b> 아무 숫자나 여섯 번 누르면 들어간다 — 그것이 그 화면의 설계이고,
 * 여기서 그것에 기대는 것이 아니라 <b>그 사실을 밟아 확인하는 것</b>이다.
 *
 * <p>로그인 화면이 아니면 아무 일도 하지 않는다. 부르는 쪽이 "지금 로그인 화면인가"를
 * 따지지 않아도 되게 하려는 것 — {@link passOnboarding}이 같은 모양으로 있다.
 */
export async function signIn(page: Page, name = "김순자"): Promise<void> {
  const card = page.getByRole("button", { name: new RegExp(name) });
  if (!(await seen(card))) return;

  await card.click();
  const key = page.getByRole("button", { name: "숫자 7" });
  await key.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  for (let pressed = 0; pressed < 6; pressed += 1) await key.click();

  await page
    .getByRole("group", { name: "화면 방식" })
    .waitFor({ state: "visible", timeout: STEP_TIMEOUT });
}

export async function passOnboarding(page: Page): Promise<void> {
  const first = page.getByRole("button", { name: /돈을 보내요/ });
  if (!(await seen(first))) return;
  await first.click();
  await page.getByRole("button", { name: /^보통$/ }).click();
  await page
    .getByRole("button", { name: /말로 찾기/ })
    .waitFor({ state: "visible", timeout: STEP_TIMEOUT });
}

/**
 * `page.evaluate`에 넘긴 함수가 페이지에서 도는 데 필요한 shim.
 *
 * <p>tsx(esbuild)는 이름 있는 함수에 `__name` 헬퍼를 붙이는데, 그 함수를 문자열로
 * 직렬화해 브라우저로 보내면 헬퍼가 따라가지 않아 `ReferenceError`가 난다.
 * `services/harvester/src/probe.ts`가 같은 자리에서 같은 것을 겪고 같은 shim을 둔다.
 */
export const EVAL_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

/** 페이지마다 shim이 미리 들어간 문맥. `evaluate`를 쓰는 쪽은 이것을 쓴다. */
export async function newContextWithShim(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await context.addInitScript(EVAL_SHIM);
  return context;
}

export async function launch(): Promise<Browser> {
  // 저장소의 수집기와 같은 순서다 — 설치된 크롬을 먼저, 없으면 번들 크로미움.
  const chrome = await chromium.launch({ channel: "chrome", headless: true }).catch(() => null);
  if (chrome) return chrome;

  const bundled = await chromium.launch({ headless: true }).catch(() => null);
  if (bundled) return bundled;

  throw new Error(
    "브라우저를 열지 못했습니다. 크롬이 설치돼 있어야 합니다 " +
      "(playwright-core는 브라우저를 내려받지 않습니다).",
  );
}

/** 배포가 아직 안 올라왔을 수 있다. **횟수를 정해 두고만** 기다린다. */
export async function waitForDeploy(maxAttempts = Number(process.env["SMOKE_RETRIES"] ?? 5)) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(BASE, { method: "GET" });
      if (response.ok) return;
      console.log(`  ${BASE} → ${response.status} (${attempt}/${maxAttempts})`);
    } catch {
      console.log(`  ${BASE} → 닿지 않음 (${attempt}/${maxAttempts})`);
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 6_000));
  }
  throw new Error(
    `${BASE}에 ${maxAttempts}번 시도했지만 닿지 못했습니다. ` +
      `주소가 맞는지, 배포가 끝났는지 확인하세요 — 다른 주소를 찾아보지는 않습니다.`,
  );
}

/** 한 묶음의 결과를 찍고, 실패했으면 참을 돌려준다. */
export function report(name: string, problems: Problem[]): boolean {
  if (problems.length === 0) {
    console.log(`  ✓ ${name}`);
    return false;
  }
  console.log(`  ✗ ${name}`);
  for (const problem of problems) console.log(`      [${problem.kind}] ${problem.detail}`);
  return true;
}
