import type { Browser, BrowserContext, Page } from "playwright-core";
import {
  BANK,
  BASE,
  expect,
  launch,
  passOnboarding,
  report,
  seen,
  signIn,
  STEP_TIMEOUT,
  waitForDeploy,
  type Problem,
} from "./browser.js";

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


interface Scenario {
  name: string;
  run: (page: Page, problems: Problem[]) => Promise<void>;
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
      expect(
        !(await seen(page.getByRole("button", { name: "+다른 금융사 얹어 보기" }), 1_500)),
        "숨긴 Studio 진입 버튼이 화면에 보인다",
        problems,
      );
      expect(
        !(await seen(page.getByText(/수집본|이식 검증용|메뉴 체계를 그대로/), 1_500)),
        "금융사 메뉴의 부연 설명이 화면에 남아 있다",
        problems,
      );

      await page.getByRole("button", { name: "원래 메뉴" }).click();
      expect(
        !(await seen(page.getByText(/메뉴 체계를 그대로 펼친 화면입니다/), 1_500)),
        "원래 메뉴에 금융사 메뉴 부연 설명이 남아 있다",
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
    name: "③ 은행 시연의 바깥 도구와 고정 화면이 보인다",
    run: async (page, problems) => {
      await page.goto(BANK, {
        waitUntil: "domcontentloaded",
        timeout: STEP_TIMEOUT,
      });
      await signIn(page);

      const notice = page.getByRole("complementary", { name: "가상 오픈뱅킹 시연" });
      expect(await seen(notice), "가상 원장 초기화 도구가 안 보인다", problems);

      const noticeText = (await seen(notice)) ? await notice.innerText() : "";
      expect(
        noticeText.trim() === "가상 원장 초기화",
        `초기화 도구에 부연 설명이 남아 있다: ${noticeText.slice(0, 80)}`,
        problems,
      );
      expect(
        await seen(page.getByRole("link", { name: /이전 화면/ })),
        "이전 화면 버튼이 안 보인다",
        problems,
      );

      const controlsAreOutside = await page.evaluate(() => {
        const frame = document.querySelector(".app")?.getBoundingClientRect();
        const reset = document.querySelector(".demo-data-notice")?.getBoundingClientRect();
        const back = document.querySelector(".demo-back-link")?.getBoundingClientRect();
        return Boolean(frame && reset && back && reset.left >= frame.right && back.left >= frame.right);
      });
      expect(controlsAreOutside, "초기화·이전 화면 도구가 휴대폰 프레임 밖 오른쪽에 있지 않다", problems);

      await passOnboarding(page);

      expect(
        await seen(page.locator('.minui-root[data-support-level="standard"]')),
        "고정된 기본 화면이 안 보인다",
        problems,
      );
      expect(
        !(await seen(page.locator(".adaptive-support"), 1_500)),
        "화면 도움 선택 UI가 남아 있다",
        problems,
      );
      expect(
        !(await seen(page.getByRole("button", { name: /연습해 보기|연습 끝내기/ }), 1_500)),
        "연습 이체 기능이 화면에 남아 있다",
        problems,
      );
      expect(
        !(await seen(page.getByRole("button", { name: /AI 도우미 끄고 보기|다시 켜기/ }), 1_500)),
        "AI 도우미 스위치가 화면에 남아 있다",
        problems,
      );
      expect(
        !(await seen(page.getByRole("button", { name: "왜 이렇게 보이나요?" }), 1_500)),
        "왜 이렇게 보이나요? 버튼이 화면에 남아 있다",
        problems,
      );
      expect(
        !(await seen(page.getByRole("button", { name: "이 화면에 의견 남기기" }), 1_500)),
        "의견 남기기 버튼이 화면에 남아 있다",
        problems,
      );

      const sessionIsOutside = await page.evaluate(() => {
        const frame = document.querySelector(".app")?.getBoundingClientRect();
        const session = document.querySelector(".demo-session")?.getBoundingClientRect();
        return Boolean(frame && session && session.right <= frame.left);
      });
      expect(sessionIsOutside, "사용자·나가기 도구가 휴대폰 프레임 밖 왼쪽에 있지 않다", problems);
    },
  },

  {
    name: "④ 수취인·금액 없이 보내면 전송되지 않고 이유를 말한다",
    run: async (page, problems) => {
      await page.goto(BANK, {
        waitUntil: "domcontentloaded",
        timeout: STEP_TIMEOUT,
      });
      await signIn(page);
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

      // 확인 단계가 생기면서 이 화면의 주 버튼이 바뀌었다 (F13).
      await screen.getByRole("button", { name: "내용 확인하기" }).click();
      expect(
        await seen(screen.getByText(/받는 분을 선택/)),
        "빈 채로 보냈는데 이유를 말하지 않는다",
        problems,
      );
      expect(
        // 확인 화면은 다이얼로그 **이름이 바뀐다**(`보낼 내용 확인`). `screen`이 아니라
        // 페이지에서 찾아야 "안 떴다"가 진짜 안 떴다는 뜻이 된다.
        !(await seen(page.getByRole("button", { name: "네, 확인하고 보내기" }), 1_500)),
        "보낼 것이 정해지지도 않았는데 확인 화면이 떴다 ★",
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
      await page.goto(BANK, {
        waitUntil: "domcontentloaded",
        timeout: STEP_TIMEOUT,
      });
      await signIn(page);
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
      /*
       * **확인 단계 셋** (F13). 내용 확인 → 수취 정보 확인 표시 → 보내기.
       * 사람이 읽어야 하는 자리가 하나 늘었고, 그것이 §9.3의 "최종 확정은 사람이
       * 한다"를 화면에서 실제로 밟게 한다. 스모크도 사람과 같은 길을 간다.
       */
      await screen.getByRole("button", { name: "내용 확인하기" }).click();
      // 다이얼로그 이름이 `계좌 이체` → `보낼 내용 확인`으로 바뀐다. 같은 로케이터로
      // 이어서 찾으면 아무것도 못 찾는다.
      const confirming = page.getByRole("dialog", { name: "보낼 내용 확인" });
      await confirming.getByRole("checkbox").check();
      await confirming.getByRole("button", { name: "네, 확인하고 보내기" }).click();

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
    await page.goto(BANK, {
      waitUntil: "domcontentloaded",
      timeout: STEP_TIMEOUT,
    });
    await signIn(page);
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

  if (report(scenario.name, problems)) failures.push({ scenario: scenario.name, problems });
}

{
  const problems: Problem[] = [];
  const name = "⑥ 새 문맥은 초기값에서 시작한다";
  await freshContextStartsClean(browser, problems).catch((error: unknown) => {
    problems.push({ kind: "assert", detail: String(error).split("\n")[0]! });
  });
  if (report(name, problems)) failures.push({ scenario: name, problems });
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n  실패 ${failures.length}건 — 대상 ${BASE}\n`);
  process.exitCode = 1;
} else {
  console.log(`\n  ${SCENARIOS.length + 1}개 시나리오 통과 — ${BASE}\n`);
}
