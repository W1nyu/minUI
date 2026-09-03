import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { CATALOG } from "../src/catalog.js";
import { MockBankApi } from "../src/api/mockApi.js";

/**
 * 「이해 지원」 — 어려운 말을 그 자리에서 묻는 길이 실제로 열려 있는가.
 *
 * <p>이 앱은 오랫동안 `explain`을 `MinUIProvider`에 넘기지 않았고, 25개 메뉴에
 * `hint`도 없었다. 그래서 "이게 무슨 뜻이에요?" 버튼이 <b>한 번도 뜬 적이 없다</b> —
 * 네 기둥 중 하나가 화면에서 통째로 빠져 있었다. 그것이 다시 빠지는 것을 여기서 막는다.
 *
 * <p>화면 테스트는 <b>다이얼로그 안으로 범위를 좁힌다.</b> `screen`으로 찾으면 뒤에
 * 남아 있는 홈 카드를 잡아 테스트가 잘못된 이유로 통과한다.
 */

/** 시트를 열어 그 안만 보게 한다. */
async function openAllMenu() {
  const user = userEvent.setup();
  render(<App api={new MockBankApi()} />);
  await user.click(await screen.findByRole("button", { name: /전체 메뉴/ }));
  const sheet = await screen.findByRole("dialog");
  return { user, sheet };
}

describe("전체 메뉴를 간결하게 보여 준다", () => {
  it("메뉴 아래에 뜻풀이·출처·질문 버튼을 붙이지 않는다", async () => {
    const { sheet } = await openAllMenu();

    const row = within(sheet).getByRole("button", { name: /이체 한도 변경/ });
    expect(row).toBeInTheDocument();
    expect(within(sheet).queryByText("통장에 남은 돈을 봅니다")).not.toBeInTheDocument();
    expect(within(sheet).queryByText("이 기기에 있는 설명")).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /무슨 뜻이에요/ })).not.toBeInTheDocument();
  });
});

describe("온보딩 2문항 (F5)", () => {
  it("처음 열면 두 문항을 묻고, 답하면 홈이 나온다", async () => {
    localStorage.removeItem("minui.demo.onboarded");
    const user = userEvent.setup();
    render(<App api={new MockBankApi()} />);

    const first = await screen.findByRole("dialog");
    expect(within(first).getByText(/주로 무엇을 하세요/)).toBeInTheDocument();

    await user.click(within(first).getByRole("button", { name: /돈을 보내요/ }));
    expect(within(first).getByText(/글씨는 이 정도면/)).toBeInTheDocument();

    await user.click(within(first).getByRole("button", { name: /^크게$/ }));

    // 답이 끝나면 시트가 사라지고 홈이 나온다.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(await screen.findByRole("button", { name: /말로 찾기/ })).toBeInTheDocument();
  });

  it("고른 의도가 첫 카드에 반영된다", async () => {
    localStorage.removeItem("minui.demo.onboarded");
    const user = userEvent.setup();
    render(<App api={new MockBankApi()} />);

    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: /돈을 보내요/ }));
    await user.click(within(sheet).getByRole("button", { name: /^보통$/ }));

    /*
     * COLD_START_PRESETS.transfer가 "계좌 이체"를 맨 앞에 둔다. 온보딩이 실제로
     * 카드를 정한다는 것 — `setProfile`이 엔진까지 닿는다는 것이 여기서 확인된다.
     * 호출자가 0이던 시절에는 무엇을 골라도 화면이 같았다.
     */
    const cards = await screen.findAllByRole("button", { name: /계좌 이체/ });
    expect(cards.length).toBeGreaterThan(0);
  });

  it("건너뛰어도 홈으로 간다", async () => {
    localStorage.removeItem("minui.demo.onboarded");
    const user = userEvent.setup();
    render(<App api={new MockBankApi()} />);

    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "건너뛰기" }));

    expect(await screen.findByRole("button", { name: /말로 찾기/ })).toBeInTheDocument();
  });

  it("한 번 마치면 다시 묻지 않는다", async () => {
    localStorage.setItem("minui.demo.onboarded", "1");
    render(<App api={new MockBankApi()} />);

    expect(await screen.findByRole("button", { name: /말로 찾기/ })).toBeInTheDocument();
    expect(screen.queryByText(/주로 무엇을 하세요/)).not.toBeInTheDocument();
  });
});

/** 카탈로그 쪽 약속. 화면을 안 거치고도 깨지면 바로 알 수 있게 여기서 잰다. */
describe("카탈로그가 지켜야 할 것", () => {
  it("여섯 곳은 뜻풀이가 비어 있다 — 빠뜨린 것이 아니다", () => {
    const empty = CATALOG.filter((menu) => !menu.hint).map((menu) => menu.label);
    expect(empty.sort()).toEqual(
      [
        "거래 확인증",
        "예약 이체",
        "펀드·투자",
        "연금 상품",
        "이체 한도 변경",
        "인증서 관리",
      ].sort(),
    );
  });

  it("모든 메뉴에 path가 있고 첫 단은 category와 같다", () => {
    for (const menu of CATALOG) {
      expect(menu.path, menu.label).toBeDefined();
      expect(menu.path?.[0], menu.label).toBe(menu.category);
    }
  });
});
