import { MemoryStorageAdapter, type ColdStartPresets, type MenuCatalog } from "@minui/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { MinUIHome } from "../src/MinUIHome.js";
import { MinUIProvider } from "../src/MinUIProvider.js";
import { TextScaleControl } from "../src/TextScaleControl.js";

const CATALOG: MenuCatalog = [
  { id: "inquiry.balance", label: "잔액 보기", category: "조회", icon: "wallet", route: "/b", riskLevel: "low" },
  { id: "inquiry.history", label: "거래 내역", category: "조회", icon: "list", route: "/h", riskLevel: "low" },
  { id: "transfer.account", label: "계좌 이체", category: "이체", icon: "transfer", route: "/t", riskLevel: "high" },
  { id: "transfer.auto", label: "자동이체 관리", category: "이체", icon: "repeat", route: "/a", riskLevel: "high" },
  { id: "settings.limit", label: "한도 변경", category: "설정", icon: "gauge", route: "/l", riskLevel: "high" },
  { id: "support.call", label: "전화 상담", category: "설정", icon: "phone", route: "/c", riskLevel: "low" },
];

const PRESETS: ColdStartPresets = {
  inquiry: ["inquiry.balance", "inquiry.history", "transfer.account", "support.call"],
  transfer: ["transfer.account", "transfer.auto", "inquiry.balance", "inquiry.history"],
  invest: ["inquiry.balance", "inquiry.history", "transfer.account", "support.call"],
};

function renderHome(onAction = vi.fn()) {
  const result = render(
    <MinUIProvider
      catalog={CATALOG}
      onAction={onAction}
      storage={new MemoryStorageAdapter()}
      coldStartPresets={PRESETS}
      fallback={<p>불러오는 중</p>}
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
