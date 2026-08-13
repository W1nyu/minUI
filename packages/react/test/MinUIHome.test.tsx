import { MemoryStorageAdapter, type ColdStartPresets, type MenuCatalog } from "@minui/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { MinUIHome } from "../src/MinUIHome.js";
import { MinUIProvider } from "../src/MinUIProvider.js";
import { TextScaleControl } from "../src/TextScaleControl.js";

/**
 * `hint`가 붙은 메뉴와 안 붙은 메뉴를 섞어 둔다. 실제 카탈로그가 그렇다 —
 * 신한 930개 중 745개에만 있다. 없는 쪽이 빈 자리를 만들지 않는 것도 요구사항이다.
 */
const CATALOG: MenuCatalog = [
  { id: "inquiry.balance", label: "잔액 보기", hint: "지금 통장에 남아 있는 돈이에요", category: "조회", icon: "wallet", route: "/b", riskLevel: "low" },
  { id: "inquiry.history", label: "거래 내역", category: "조회", icon: "list", route: "/h", riskLevel: "low" },
  { id: "transfer.account", label: "계좌 이체", category: "이체", icon: "transfer", route: "/t", riskLevel: "high" },
  { id: "transfer.auto", label: "자동이체 관리", hint: "매달 저절로 나가는 돈이에요", category: "이체", icon: "repeat", route: "/a", riskLevel: "high" },
  { id: "settings.limit", label: "한도 변경", hint: "하루에 보낼 수 있는 최대 금액을 바꿔요", category: "설정", icon: "gauge", route: "/l", riskLevel: "high" },
  { id: "support.call", label: "전화 상담", hint: "궁금한 걸 사람에게 물어봐요", category: "설정", icon: "phone", route: "/c", riskLevel: "low" },
];

const PRESETS: ColdStartPresets = {
  inquiry: ["inquiry.balance", "inquiry.history", "transfer.account", "support.call"],
  transfer: ["transfer.account", "transfer.auto", "inquiry.balance", "inquiry.history"],
  invest: ["inquiry.balance", "inquiry.history", "transfer.account", "support.call"],
};

function renderHome(
  onAction = vi.fn(),
  explain?: (menuId: string) => Promise<string | null>,
) {
  const result = render(
    <MinUIProvider
      catalog={CATALOG}
      onAction={onAction}
      storage={new MemoryStorageAdapter()}
      coldStartPresets={PRESETS}
      fallback={<p>불러오는 중</p>}
      {...(explain ? { explain } : {})}
    >
      <MinUIHome
        catalog={CATALOG}
        renderCardDetail={(id) => (id === "inquiry.balance" ? <strong>1,243,500원</strong> : null)}
      />
    </MinUIProvider>,
  );
  return { ...result, onAction };
}

async function waitForCards() {
  await waitFor(() => expect(screen.getByRole("button", { name: /잔액 보기/ })).toBeInTheDocument());
}

describe("카드 홈", () => {
  it("콜드 스타트 프리셋 카드 4장을 그린다", async () => {
    renderHome();
    await waitForCards();

    for (const label of ["잔액 보기", "거래 내역", "계좌 이체", "전화 상담"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /한도 변경/ })).not.toBeInTheDocument();
  });

  it("카드가 답을 함께 보여준다 — 잔액은 탭 없이 읽힌다 (기획안 S2)", async () => {
    renderHome();
    await waitForCards();

    expect(screen.getByRole("button", { name: /잔액 보기/ })).toHaveTextContent("1,243,500원");
  });

  it("카드를 누르면 호스트의 ActionHandler가 불린다", async () => {
    const onAction = vi.fn();
    renderHome(onAction);
    await waitForCards();

    await userEvent.click(screen.getByRole("button", { name: /계좌 이체/ }));

    expect(onAction).toHaveBeenCalledWith("transfer.account", undefined);
  });

  it("아이콘은 이름을 갖지 않는다 — 접근성 이름은 항상 글자에서 온다", async () => {
    const { container } = renderHome();
    await waitForCards();

    const icons = container.querySelectorAll(".minui-card-icon");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});

/**
 * 어려운 말 풀이 (기획안 §15).
 *
 * 메뉴를 찾는 것과 그게 뭔지 아는 것은 다른 문제다. `예수금`·`반대매매`처럼
 * 도착해도 못 쓰는 말이 있다. 카탈로그에 `hint`가 이미 들어 있는데 화면에 나오지
 * 않는 상태였다 — 여기서 실제로 보이게 한다.
 */
describe("어려운 말 풀이", () => {
  it("답이 없는 카드는 뜻풀이를 대신 보여 준다", async () => {
    renderHome();
    await waitForCards();

    expect(screen.getByRole("button", { name: /전화 상담/ })).toHaveTextContent(
      "궁금한 걸 사람에게 물어봐요",
    );
  });

  it("답이 있으면 답만 보여 준다 — 카드에 두 줄을 겹쳐 쓰지 않는다 (원칙 P1)", async () => {
    renderHome();
    await waitForCards();

    const card = screen.getByRole("button", { name: /잔액 보기/ });
    expect(card).toHaveTextContent("1,243,500원");
    expect(card).not.toHaveTextContent("지금 통장에 남아 있는 돈이에요");
  });

  it("전체 메뉴에서 뜻풀이가 함께 뜬다", async () => {
    renderHome();
    await waitForCards();
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));

    const dialog = screen.getByRole("dialog", { name: "전체 메뉴" });
    expect(
      within(dialog).getByText("하루에 보낼 수 있는 최대 금액을 바꿔요"),
    ).toBeInTheDocument();
  });

  /**
   * 이름이 아니라 설명으로 붙어야 한다. 700줄짜리 목록에서 모든 버튼 이름이
   * "메뉴명 + 한 문장"이 되면 스크린리더 사용자가 훑어 나갈 수가 없다.
   */
  it("전체 메뉴의 뜻풀이는 이름이 아니라 설명으로 붙는다", async () => {
    renderHome();
    await waitForCards();
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));

    const dialog = screen.getByRole("dialog", { name: "전체 메뉴" });
    const open = within(dialog).getByRole("button", { name: "한도 변경" });

    const describedBy = open.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "하루에 보낼 수 있는 최대 금액을 바꿔요",
    );
  });

  it("뜻풀이가 없는 메뉴에는 빈 자리를 만들지 않는다", async () => {
    renderHome();
    await waitForCards();
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));

    const dialog = screen.getByRole("dialog", { name: "전체 메뉴" });
    expect(within(dialog).getByRole("button", { name: "거래 내역" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});

/**
 * 카탈로그가 못 채운 메뉴는 그 자리에서 묻는다.
 *
 * 빌드 타임 보강이 대부분을 채우지만 전부는 아니다(신한 930개 중 745개).
 * 나머지에만 도우미가 붙는다 — 검색 폴백과 같은 구조다.
 */
describe("이게 무슨 뜻이에요? (런타임 뜻풀이)", () => {
  const ASK = "이게 무슨 뜻이에요?";

  async function openMenus(explain?: (menuId: string) => Promise<string | null>) {
    renderHome(vi.fn(), explain);
    await waitForCards();
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));
    return screen.getByRole("dialog", { name: "전체 메뉴" });
  }

  function rowOf(dialog: HTMLElement, label: string) {
    return within(dialog).getByRole("button", { name: label }).closest("li")!;
  }

  it("도우미가 없으면 묻는 버튼도 없다 — LLM 없이 100% 돈다", async () => {
    const dialog = await openMenus();

    expect(within(dialog).queryByRole("button", { name: ASK })).not.toBeInTheDocument();
  });

  it("뜻풀이가 이미 있는 메뉴에는 묻지 않는다", async () => {
    const dialog = await openMenus(async () => "쓰이지 않아야 한다");

    expect(
      within(rowOf(dialog, "한도 변경")).queryByRole("button", { name: ASK }),
    ).not.toBeInTheDocument();
  });

  it("뜻풀이가 없는 메뉴에만 묻는 버튼이 붙는다", async () => {
    const dialog = await openMenus(async () => "지난 거래를 모아 봐요");

    expect(
      within(rowOf(dialog, "거래 내역")).getByRole("button", { name: ASK }),
    ).toBeInTheDocument();
  });

  it("누르면 그 자리에 풀이가 뜨고 설명으로 연결된다", async () => {
    const dialog = await openMenus(async () => "지난 거래를 모아 봐요");

    await userEvent.click(
      within(rowOf(dialog, "거래 내역")).getByRole("button", { name: ASK }),
    );

    const open = within(dialog).getByRole("button", { name: "거래 내역" });
    await waitFor(() => expect(open).toHaveAttribute("aria-describedby"));
    expect(
      document.getElementById(open.getAttribute("aria-describedby")!),
    ).toHaveTextContent("지난 거래를 모아 봐요");
  });

  /** 도우미가 모르면 모른다고 한다. 틀린 풀이는 없는 것보다 나쁘다. */
  it("도우미가 답을 못 주면 막다른 길을 만들지 않는다", async () => {
    const dialog = await openMenus(async () => null);

    await userEvent.click(
      within(rowOf(dialog, "거래 내역")).getByRole("button", { name: ASK }),
    );

    await waitFor(() =>
      expect(within(rowOf(dialog, "거래 내역"))
        .getByText(/알 수 없|찾지 못/)).toBeInTheDocument(),
    );
  });

  it("도우미가 죽어도 화면은 그대로다", async () => {
    const dialog = await openMenus(async () => {
      throw new Error("네트워크 끊김");
    });

    await userEvent.click(
      within(rowOf(dialog, "거래 내역")).getByRole("button", { name: ASK }),
    );

    await waitFor(() =>
      expect(within(rowOf(dialog, "거래 내역"))
        .getByText(/알 수 없|찾지 못/)).toBeInTheDocument(),
    );
    expect(within(dialog).getByRole("button", { name: "거래 내역" })).toBeInTheDocument();
  });
});

describe("전체 메뉴 (원칙 P2)", () => {
  it("카드에 없는 기능도 전부 도달 가능하다", async () => {
    renderHome();
    await waitForCards();

    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));

    const dialog = screen.getByRole("dialog", { name: "전체 메뉴" });
    for (const menu of CATALOG) {
      expect(within(dialog).getByRole("button", { name: menu.label })).toBeInTheDocument();
    }
  });

  it("Escape로 닫힌다", async () => {
    renderHome();
    await waitForCards();
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("열면 돌아가기 버튼에 초점이 간다", async () => {
    renderHome();
    await waitForCards();

    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /돌아가기/ })).toHaveFocus(),
    );
  });

  it("고정하면 그 자리에서 카드로 올라온다", async () => {
    renderHome();
    await waitForCards();
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));

    const dialog = screen.getByRole("dialog");
    const row = within(dialog).getByRole("button", { name: "한도 변경" }).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "홈에 고정" }));
    await userEvent.click(screen.getByRole("button", { name: /돌아가기/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /한도 변경/ })).toBeInTheDocument(),
    );
  });
});

describe("글씨 크기", () => {
  /** 홈이 아니라 전체 메뉴 안에 있다 — 카드와 시선을 다투지 않게 하려는 배치다. */
  async function openSettings() {
    renderHome();
    await waitForCards();
    expect(screen.queryByRole("button", { name: /글씨 크기/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));
  }

  it("선택한 단계가 문서 루트에 반영된다", async () => {
    await openSettings();

    await userEvent.click(screen.getByRole("button", { name: "글씨 크기 아주 크게" }));

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-minui-scale", "xlarge"),
    );
  });

  it("현재 단계가 눌린 상태로 표시된다", async () => {
    await openSettings();

    expect(screen.getByRole("button", { name: "글씨 크기 보통" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("axe 자동 검사", () => {
  it("카드 홈에 위반이 없다", async () => {
    const { container } = renderHome();
    await waitForCards();

    const results = await axe.run(container, AXE_OPTIONS);
    expect(describeViolations(results.violations)).toEqual([]);
  });

  it("전체 메뉴에 위반이 없다", async () => {
    const { container } = renderHome();
    await waitForCards();
    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));

    const results = await axe.run(container, AXE_OPTIONS);
    expect(describeViolations(results.violations)).toEqual([]);
  });
});

/**
 * jsdom은 CSS를 계산하지 않으므로 색 대비와 크기 규칙은 axe로 잴 수 없다.
 * 그 두 축은 tokens.test.ts가 원본 토큰 값에서 직접 계산해 검증한다.
 */
const AXE_OPTIONS: axe.RunOptions = {
  rules: {
    "color-contrast": { enabled: false },
    "target-size": { enabled: false },
  },
};

function describeViolations(violations: axe.Result[]): string[] {
  return violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}곳)`);
}
