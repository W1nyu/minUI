import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";

/**
 * 공개 배포를 **실제 브라우저로 밟아 본다.**
 *
 * <p>Vitest 780건은 로컬 소스를 잰다. 그런데 GitHub Pages에서만 생기는 문제가 따로 있다 —
 * base path(`/minUI/`), 정적 자산 경로, `/api/*`의 부재, 브라우저 저장소. 그것들은
 * <b>배포된 주소를 열어 봐야</b> 드러난다.
 *
 * <p>여기서 실제 금융망과 통신하는 것은 없다. 이 데모의 이체는 브라우저 안의 가상 원장이고,
 * 실제 OAuth 권한·실제 계좌·API 키는 하나도 필요하지 않다.
 *
 * <p><b>실패하면 어디가 왜 틀렸는지 바로 알 수 있게</b> 적는다 — 어느 주소, 어느 시나리오,
 * 어느 자산인지. 스모크 테스트가 "어딘가 깨졌다"만 말하면 고치는 데 더 오래 걸린다.
 *
 * <p>배포 반영은 늦을 수 있다. <b>횟수를 정해 두고</b> 기다리며, 그래도 안 되면 그대로
 * 실패한다 — 무한 대기하거나 다른 주소를 찍어 보지 않는다.
 *
 * <pre>
 *   pnpm --filter @minui/smoke smoke
 *   SMOKE_BASE_URL=http://localhost:5174/ pnpm --filter @minui/smoke smoke
 * </pre>
 */

const BASE = (process.env["SMOKE_BASE_URL"] ?? "https://w1nyu.github.io/minUI/").replace(
  /\/?$/,
  "/",
);

/** 배포 반영을 기다리는 횟수. 무한히 기다리지 않는다. */
const MAX_ATTEMPTS = Number(process.env["SMOKE_RETRIES"] ?? 5);
const RETRY_WAIT_MS = 6_000;

/** 한 시나리오가 걸릴 수 있는 최대 시간. 넘으면 그대로 실패다. */
const STEP_TIMEOUT = 15_000;

// ── 관찰 ──────────────────────────────────────────────────────────────────

interface Problem {
  kind: "console" | "request" | "assert";
  detail: string;
}

/**
 * 그 문맥에서 일어난 나쁜 일을 모은다.
 *
 * <p>콘솔 오류와 <b>실패한 요청</b>을 함께 본다. 정적 배포에서 가장 흔한 고장이
 * "자산 하나가 404인데 화면은 그럭저럭 뜨는" 형태라, 눈으로만 보면 놓친다.
 */
function watch(page: Page, problems: Problem[]): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    /*
     * 정적 배포에는 `/api/*`가 없고, 그래서 나는 실패는 **설계된 것**이다.
     * 화면은 되묻기와 로컬 검색으로 이어진다. 이것까지 오류로 세면 스모크가
     * 늘 빨개져서 아무도 안 보게 된다.
     */
    if (/\/api\/(assist|match|explain|studio)/.test(text)) return;
    /*
     * "Failed to load resource: ... 404"는 어느 자산인지 안 알려 준다. 같은 사건을
     * 아래 response 핸들러가 **주소까지 붙여** 보고하므로 여기서는 버린다 —
     * 실패 메시지가 무엇을 고쳐야 할지 말해 주지 않으면 없느니만 못하다.
     */
    if (/Failed to load resource/i.test(text)) return;
    problems.push({ kind: "console", detail: text.slice(0, 200) });
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (/\/api\/(assist|match|explain|studio)/.test(url)) return;
    problems.push({
      kind: "request",
      detail: `${request.method()} ${url} — ${request.failure()?.errorText ?? "실패"}`,
    });
  });

  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (/\/api\/(assist|match|explain|studio)/.test(url)) return;
    // Pages는 없는 경로에 404.html을 주면서 상태는 404로 남긴다. 자산만 본다.
    if (!/\.(js|css|json|png|svg|woff2?|ico)(\?|$)/.test(url)) return;
    problems.push({ kind: "request", detail: `${response.status()} ${url}` });
  });
}

function expect(condition: unknown, message: string, problems: Problem[]): void {
  if (!condition) problems.push({ kind: "assert", detail: message });
}

/**
 * 이 요소가 실제로 뜨는가. **기다린다.**
 *
 * <p>`locator.isVisible()`은 기다리지 않고 그 순간을 답한다. React가 그리기 전에 물으면
 * 언제나 거짓이고, 그러면 스모크가 "화면이 없다"고 말한다 — 실제로는 늦었을 뿐이다.
 * 처음에 그렇게 짰다가 여섯 중 다섯이 거짓으로 실패했다.
 */
async function seen(locator: Locator, timeout = STEP_TIMEOUT): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

// ── 시나리오 ──────────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  run: (page: Page, problems: Problem[]) => Promise<void>;
}

/** 온보딩 2문항을 넘긴다. 새 문맥마다 뜬다 — 그것이 정상이다. */
async function passOnboarding(page: Page): Promise<void> {
  const first = page.getByRole("button", { name: /돈을 보내요/ });
  if (!(await seen(first))) return; // 이미 지난 문맥이면 그냥 넘어간다
  await first.click();
  await page.getByRole("button", { name: /^보통$/ }).click();
  // 홈이 실제로 떴는지까지 확인하고 돌려준다 — 여기서 안 기다리면 다음 단계가 헛친다.
  await page.getByRole("button", { name: /말로 찾기/ }).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
}

const SCENARIOS: Scenario[] = [
  {
    name: "① 루트가 뜨고 금융사 전환과 쉬운 모드가 보인다",
    run: async (page, problems) => {
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });

      const switcher = page.getByRole("navigation", { name: "이식 대상" });
      expect(await seen(switcher), "금융사 전환 탭이 안 보인다", problems);

      const tabs = await switcher.getByRole("button").allInnerTexts();
      expect(tabs.length >= 2, `금융사 탭이 ${tabs.length}개뿐이다`, problems);

      expect(
        await seen(page.getByRole("button", { name: "쉬운 모드" })),
        "쉬운 모드 버튼이 안 보인다",
        problems,
      );

      // 다른 금융사로 바꿔도 화면이 서는지. base path가 깨지면 여기서 죽는다.
      const second = switcher.getByRole("button").nth(1);
      const name = (await second.innerText()).trim();
      await second.click();
      expect(
        await seen(page.getByText(name, { exact: false })),
        `${name}으로 전환했는데 화면이 바뀌지 않았다`,
        problems,
      );
    },
  },

  {
    name: "② 루트에서 은행 시연으로 갈 수 있다",
    run: async (page, problems) => {
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });

      const cta = page.getByRole("link", { name: /가상 이체 시연/ });
      expect(await seen(cta), "가상 이체 시연 통로가 첫 화면에 없다", problems);

      const href = await cta.getAttribute("href");
      expect(
        href === new URL("bank/", BASE).pathname,
        `통로의 주소가 배포 기준 경로와 다르다: ${href}`,
        problems,
      );

      await cta.click();
      await page.waitForLoadState("domcontentloaded");
      expect(
        page.url().includes("/bank/"),
        `눌렀는데 은행 시연으로 안 갔다: ${page.url()}`,
        problems,
      );
    },
  },

  {
    name: "③ 은행 시연에 Mock 고지와 적응 UI 동의가 보인다",
    run: async (page, problems) => {
      await page.goto(new URL("bank/", BASE).href, {
        waitUntil: "domcontentloaded",
        timeout: STEP_TIMEOUT,
      });

      const notice = page.getByRole("complementary", { name: /가상 오픈뱅킹 시연 안내/ });
      expect(await seen(notice), "가상 오픈뱅킹 고지가 안 보인다", problems);

      // 안쪽 <strong>만 잡으면 제목만 읽고 본문을 못 본다.
      const noticeText = (await seen(notice)) ? await notice.innerText() : "";
      expect(
        /실제 계좌/.test(noticeText) && /마이데이터/.test(noticeText),
        `고지에 실제 계좌·마이데이터 미연결 설명이 없다: ${noticeText.slice(0, 80)}`,
        problems,
      );

      await passOnboarding(page);

      /*
       * 동의는 **선택지가 둘 다 있어야** 동의다. "네"만 있으면 그것은 통보다.
       */
      expect(
        await seen(page.getByRole("button", { name: /네, 맞춰 주세요/ })),
        "적응 UI 동의의 '네' 선택지가 없다",
        problems,
      );
      expect(
        await seen(page.getByRole("button", { name: /아니요, 지금 화면 유지/ })),
        "적응 UI 동의의 '아니요' 선택지가 없다 — 거절할 수 없으면 동의가 아니다",
        problems,
      );
    },
  },

  {
    name: "④ 수취인·금액 없이 보내면 전송되지 않고 이유를 말한다",
    run: async (page, problems) => {
      await page.goto(new URL("bank/", BASE).href, {
        waitUntil: "domcontentloaded",
        timeout: STEP_TIMEOUT,
      });
      await passOnboarding(page);

      await page.getByRole("button", { name: /전체 메뉴/ }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: /^계좌 이체$/ }).click();

      const screen = page.getByRole("dialog", { name: "계좌 이체" });
      const payee = screen.getByLabel("받는 분");
      expect(
        (await payee.inputValue()) === "",
        "아무도 안 골랐는데 수취인이 미리 채워져 있다 (§9.3)",
        problems,
      );

      await screen.getByRole("button", { name: "보내기" }).click();
      expect(
        await seen(screen.getByText(/받는 분을 선택/)),
        "빈 채로 보냈는데 이유를 말하지 않는다",
        problems,
      );
      expect(
        !(await seen(screen.getByText(/보냈습니다/), 1_500)),
        "보내지 말아야 하는데 보냈다 ★",
        problems,
      );
    },
  },

  {
    name: "⑤ 가상 이체가 원장을 바꾸고, 새 문맥에서는 처음으로 돌아온다",
    run: async (page, problems) => {
      await page.goto(new URL("bank/", BASE).href, {
        waitUntil: "domcontentloaded",
        timeout: STEP_TIMEOUT,
      });
      await passOnboarding(page);

      const before = await page.getByRole("button", { name: /잔액 보기/ }).innerText();
      expect(/1,243,500/.test(before), `첫 잔액이 초기값이 아니다: ${before}`, problems);

      await page.getByRole("button", { name: /전체 메뉴/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: /^계좌 이체$/ }).click();

      const screen = page.getByRole("dialog", { name: "계좌 이체" });
      /*
       * `selectOption`은 정규식 라벨을 안 받는다. 보이는 글로 찾아 값을 읽어 넣는다 —
       * 옵션 문구는 "김영수 삼촌 (1002-…)"처럼 계좌번호가 붙어 있어 완전 일치가 안 된다.
       */
      const select = screen.getByLabel("받는 분");
      const uncle = select.locator("option", { hasText: "삼촌" }).first();
      await select.selectOption(await uncle.getAttribute("value") ?? "");
      await screen.getByLabel("보낼 금액").fill("30000");
      await screen.getByRole("button", { name: "보내기" }).click();

      /*
       * 성공하면 화면이 **"이체 완료"로 갈아탄다** — `계좌 이체` 다이얼로그는 사라진다.
       * 그 안에서 성공 문구를 찾으면 성공을 실패로 읽는다. 실제로 그렇게 짰다가 걸렸다.
       */
      const done = page.getByRole("dialog", { name: "이체 완료" });
      if (!(await seen(done))) {
        /*
         * 왜 안 갔는지까지 적는다. "끝까지 가지 않았다"만 보고하면 고치는 사람이
         * 다시 브라우저를 열어야 한다 — 스모크가 할 일을 안 한 것이다.
         */
        const chosen = await screen.getByLabel("받는 분").inputValue().catch(() => "(못 읽음)");
        const amount = await screen.getByLabel("보낼 금액").inputValue().catch(() => "(못 읽음)");
        const alert = await screen
          .getByRole("alert")
          .innerText()
          .catch(() => "(오류 표시 없음)");
        problems.push({
          kind: "assert",
          detail: `가상 이체가 끝까지 가지 않았다 — 수취인="${chosen}" 금액="${amount}" 화면="${alert}"`,
        });
        return;
      }

      expect(
        await seen(done.getByText(/보냈습니다/)),
        "이체 완료 화면에 보냈다는 말이 없다",
        problems,
      );

      await done.getByRole("button", { name: /뒤로/ }).first().click();
      const after = await page.getByRole("button", { name: /잔액 보기/ }).innerText();
      expect(
        /1,213,500/.test(after),
        `이체 뒤 잔액이 안 바뀌었다: ${after}`,
        problems,
      );
    },
  },
];

/**
 * ⑤가 끝난 뒤 **새 문맥**에서 초기값으로 돌아오는지 본다.
 *
 * <p>같은 문맥에서 새로고침해서는 못 잰다 — 가상 원장이 `sessionStorage`에 있어서
 * 탭이 살아 있는 한 남는다. 그것이 설계이고, <b>탭을 새로 열면 사라지는 것</b>도 설계다.
 * 참가자마다 초기 상태에서 시작한다는 약속이 여기 걸려 있다.
 */
async function freshContextStartsClean(browser: Browser, problems: Problem[]): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  watch(page, problems);
  try {
    await page.goto(new URL("bank/", BASE).href, {
      waitUntil: "domcontentloaded",
      timeout: STEP_TIMEOUT,
    });
    await passOnboarding(page);
    const balance = await page.getByRole("button", { name: /잔액 보기/ }).innerText();
    expect(
      /1,243,500/.test(balance),
      `새 문맥인데 앞 이체가 남아 있다: ${balance}`,
      problems,
    );
  } finally {
    await context.close();
  }
}

// ── 실행 ──────────────────────────────────────────────────────────────────

/** 배포가 아직 안 올라왔을 수 있다. 횟수를 정해 두고만 기다린다. */
async function waitForDeploy(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(BASE, { method: "GET" });
      if (response.ok) return;
      console.log(`  ${BASE} → ${response.status} (${attempt}/${MAX_ATTEMPTS})`);
    } catch (error) {
      console.log(`  ${BASE} → 닿지 않음 (${attempt}/${MAX_ATTEMPTS})`);
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
  }
  throw new Error(
    `${BASE}에 ${MAX_ATTEMPTS}번 시도했지만 닿지 못했습니다. ` +
      `주소가 맞는지, 배포가 끝났는지 확인하세요 — 다른 주소를 찾아보지는 않습니다.`,
  );
}

async function launch(): Promise<Browser> {
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

console.log(`\n  대상 ${BASE}\n`);
await waitForDeploy();

const browser = await launch();
const failures: { scenario: string; problems: Problem[] }[] = [];

for (const scenario of SCENARIOS) {
  // **시나리오마다 새 문맥.** 앞 시나리오의 저장소가 남으면 ⑤가 거짓으로 통과한다.
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  const problems: Problem[] = [];
  watch(page, problems);

  try {
    await scenario.run(page, problems);
  } catch (error) {
    problems.push({
      kind: "assert",
      detail: error instanceof Error ? error.message.split("\n")[0]! : String(error),
    });
  } finally {
    await context.close();
  }

  if (problems.length === 0) {
    console.log(`  ✓ ${scenario.name}`);
  } else {
    console.log(`  ✗ ${scenario.name}`);
    for (const problem of problems) console.log(`      [${problem.kind}] ${problem.detail}`);
    failures.push({ scenario: scenario.name, problems });
  }
}

{
  const problems: Problem[] = [];
  const name = "⑥ 새 문맥은 초기값에서 시작한다";
  await freshContextStartsClean(browser, problems).catch((error: unknown) => {
    problems.push({ kind: "assert", detail: String(error).split("\n")[0]! });
  });
  if (problems.length === 0) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}`);
    for (const problem of problems) console.log(`      [${problem.kind}] ${problem.detail}`);
    failures.push({ scenario: name, problems });
  }
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n  실패 ${failures.length}건 — 대상 ${BASE}\n`);
  process.exitCode = 1;
} else {
  console.log(`\n  ${SCENARIOS.length + 1}개 시나리오 통과 — ${BASE}\n`);
}
