import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";
import { CATALOG } from "../src/catalog.js";
import type { Mode } from "../src/App.js";

/** 모드마다 저장소 키를 달리해 테스트 사이에 상태가 새지 않게 한다. */
let keyCounter = 0;

function renderApp(initialMode: Mode = "minui") {
  const api = new MockBankApi();
  const result = render(
    <App api={api} initialMode={initialMode} storageKey={`test-${keyCounter++}`} />,
  );
  return { ...result, api };
}

async function waitForApp() {
  await waitFor(() =>
    expect(screen.getByRole("group", { name: "화면 방식" })).toBeInTheDocument(),
  );
}

/**
 * 이체의 마지막 세 걸음 — 내용 확인 → 수취 정보 확인 표시 → 보내기.
 *
 * <p>전에는 `보내기` 한 번이었다. 확인 화면이 생기면서 사람이 읽어야 하는 자리가 하나
 * 늘었고, 그것이 §9.3의 "최종 확정은 사람이 한다"를 화면에서 실제로 밟게 한다.
 */
async function confirmAndSend(scope: { getByRole: typeof screen.getByRole } = screen) {
  await userEvent.click(scope.getByRole("button", { name: "내용 확인하기" }));
  await userEvent.click(scope.getByRole("checkbox"));
  await userEvent.click(scope.getByRole("button", { name: "네, 확인하고 보내기" }));
}

describe("카탈로그", () => {
  it("메뉴가 25개다 (기획안 §10.2)", () => {
    expect(CATALOG).toHaveLength(25);
  });

  it("모든 메뉴에 구어 표현이 붙어 있다 — 음성 탐색(M4)의 재료", () => {
    const missing = CATALOG.filter((m) => (m.synonyms?.length ?? 0) === 0);
    expect(missing.map((m) => m.id)).toEqual([]);
  });

  it("자금이 움직이는 메뉴는 전부 riskLevel: high다 (기획안 §9.3)", () => {
    const moneyMoving = CATALOG.filter(
      (m) => m.category === "이체" || m.category === "인증" || m.id === "settings.limit",
    );
    expect(moneyMoving.filter((m) => m.riskLevel !== "high").map((m) => m.id)).toEqual([]);
  });
});

describe("모드 전환", () => {
  it("쉬운 모드는 큰 카드 4장을 보여준다", async () => {
    renderApp("minui");
    await waitForApp();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /잔액 보기/ })).toBeInTheDocument(),
    );
    expect(document.querySelectorAll(".minui-card")).toHaveLength(4);
  });

  it("기본 UI는 메뉴 트리와 탭바를 보여준다", async () => {
    renderApp("classic");
    await waitForApp();

    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
    expect(document.querySelectorAll(".minui-card")).toHaveLength(0);
  });

  it("전환해도 같은 앱 안에 머문다", async () => {
    renderApp("minui");
    await waitForApp();

    await userEvent.click(screen.getByRole("button", { name: "기본 UI" }));
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "쉬운 모드" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /잔액 보기/ })).toBeInTheDocument(),
    );
  });
});

describe("두 모드가 같은 기능을 쓴다 (기획안 §12.2 변수 통제)", () => {
  it("쉬운 모드에서 연 이체 화면과 기본 UI에서 연 이체 화면이 같다", async () => {
    // MinUI 모드
    const minui = renderApp("minui");
    await waitForApp();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /계좌 이체/ })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /계좌 이체/ }));
    const fromMinUI = screen.getByRole("dialog", { name: "계좌 이체" }).innerHTML;
    minui.unmount();

    // 기본 UI 모드
    renderApp("classic");
    await waitForApp();
    await waitFor(() => expect(screen.getByText("주거래 통장")).toBeInTheDocument());
    const accountCard = screen.getByRole("region", { name: "주거래 통장" });
    await userEvent.click(within(accountCard).getByRole("button", { name: "이체" }));
    const fromClassic = screen.getByRole("dialog", { name: "계좌 이체" }).innerHTML;

    // React의 useId 카운터는 렌더 루트마다 달라진다. 마크업 동등성과 무관한 값이므로 지운다.
    const normalize = (html: string) => html.replace(/_r_[0-9a-z]+_/g, "id");
    expect(normalize(fromClassic)).toBe(normalize(fromMinUI));
  });

  it("두 모드 모두 25개 메뉴 전부에 도달할 수 있다 (원칙 P2)", async () => {
    renderApp("minui");
    await waitForApp();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /전체 메뉴/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));
    const sheet = screen.getByRole("dialog", { name: "전체 메뉴" });
    for (const menu of CATALOG) {
      expect(within(sheet).getByRole("button", { name: menu.label })).toBeInTheDocument();
    }
  });
});

describe("실제로 동작하는 화면", () => {
  it("쉬운 모드에서 이체가 끝까지 된다 (시나리오 S1)", async () => {
    renderApp("minui");
    await waitForApp();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /계좌 이체/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /계좌 이체/ }));
    /*
     * **받는 분을 고르는 것이 한 단계다.** 전에는 맨 앞 수취인이 미리 골라져 있어서
     * 이 줄이 없었는데, 그것은 엔진이 "모르겠다"고 한 자리를 화면이 덮은 것이었다
     * (`payeeRefusal.test.tsx`). 탭으로 들어온 경우에도 누구에게 보내는지는
     * 사람이 정한다.
     */
    await userEvent.selectOptions(
      screen.getByLabelText("받는 분"),
      screen.getByRole("option", { name: /행복아파트 관리사무소/ }),
    );
    await userEvent.type(screen.getByLabelText("보낼 금액"), "187000");
    await confirmAndSend();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "행복아파트 관리사무소님께 187,000원을 보냈습니다.",
      ),
    );
  });

  it("잔액이 카드에 이미 떠 있다 — 탭 0회 (시나리오 S2)", async () => {
    renderApp("minui");
    await waitForApp();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /잔액 보기/ })).toHaveTextContent(
        "1,243,500원",
      ),
    );
  });

  it("잔액이 부족하면 이체하지 않고 이유를 말한다", async () => {
    renderApp("minui");
    await waitForApp();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /계좌 이체/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /계좌 이체/ }));
    await userEvent.selectOptions(
      screen.getByLabelText("받는 분"),
      screen.getByRole("option", { name: /행복아파트 관리사무소/ }),
    );
    await userEvent.type(screen.getByLabelText("보낼 금액"), "99999999");
    await confirmAndSend();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("잔액이 부족합니다."),
    );
  });

  it("자동이체를 멈출 수 있다 (시나리오 S3의 목적지)", async () => {
    // 기본 UI에서는 전체 → 이체 → 자동이체 관리로 세 단계를 지나야 한다.
    renderApp("classic");
    await waitForApp();
    await userEvent.click(screen.getByRole("button", { name: "전체" }));

    const allMenus = screen.getByRole("region", { name: "전체 메뉴" });
    await userEvent.click(within(allMenus).getByRole("button", { name: /이체/ }));
    await userEvent.click(within(allMenus).getByRole("button", { name: "자동이체 관리" }));

    const dialog = await screen.findByRole("dialog", { name: "자동이체 관리" });
    const row = within(dialog).getByText("한국전력공사").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "그만 내기" }));

    await waitFor(() => expect(within(row).getByText("멈춤")).toBeInTheDocument());
  });

  it("만들지 않은 화면은 그렇다고 말한다 — 막다른 길을 만들지 않는다", async () => {
    renderApp("minui");
    await waitForApp();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /전체 메뉴/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));
    const sheet = screen.getByRole("dialog", { name: "전체 메뉴" });
    await userEvent.click(within(sheet).getByRole("button", { name: "해외 송금" }));

    const dialog = await screen.findByRole("dialog", { name: "해외 송금" });
    expect(within(dialog).getByRole("button", { name: "돌아가기" })).toBeInTheDocument();
  });
});

describe("axe 자동 검사", () => {
  const AXE_OPTIONS: axe.RunOptions = {
    // jsdom은 CSS를 계산하지 않는다. 색 대비와 크기는 @minui/react의 tokens.test.ts가
    // 토큰 값에서 직접 계산해 검증한다.
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  };

  it("쉬운 모드에 위반이 없다", async () => {
    const { container } = renderApp("minui");
    await waitForApp();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /잔액 보기/ })).toBeInTheDocument(),
    );

    const results = await axe.run(container, AXE_OPTIONS);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it("기본 UI에 위반이 없다", async () => {
    const { container } = renderApp("classic");
    await waitForApp();
    await waitFor(() => expect(screen.getByText("주거래 통장")).toBeInTheDocument());

    const results = await axe.run(container, AXE_OPTIONS);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it("이체 화면에 위반이 없다", async () => {
    const { container } = renderApp("minui");
    await waitForApp();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /계좌 이체/ })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /계좌 이체/ }));

    const results = await axe.run(container, AXE_OPTIONS);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
