import { MemoryStorageAdapter, type ColdStartPresets, type MenuCatalog } from "@minui/core";
import { MockSttProvider } from "@minui/voice";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { MinUIHome } from "../src/MinUIHome.js";
import { MinUIProvider } from "../src/MinUIProvider.js";

const CATALOG: MenuCatalog = [
  {
    id: "inquiry.balance",
    label: "잔액 보기",
    synonyms: ["잔고", "돈 얼마 있어"],
    category: "조회",
    icon: "wallet",
    route: "/b",
    riskLevel: "low",
  },
  {
    id: "inquiry.history",
    label: "거래 내역",
    synonyms: ["입금 확인", "내역 보기"],
    category: "조회",
    icon: "list",
    route: "/h",
    riskLevel: "low",
  },
  {
    id: "transfer.account",
    label: "계좌 이체",
    synonyms: ["돈 보내기", "송금"],
    hint: "다른 사람 계좌로 돈을 보내요",
    category: "이체",
    icon: "transfer",
    route: "/t",
    riskLevel: "high",
  },
  {
    id: "transfer.auto",
    label: "자동이체 관리",
    synonyms: ["자동이체", "떼가는 거"],
    category: "이체",
    icon: "repeat",
    route: "/a",
    riskLevel: "high",
  },
  {
    id: "support.call",
    label: "전화 상담",
    synonyms: ["상담원"],
    category: "설정",
    icon: "phone",
    route: "/c",
    riskLevel: "low",
  },
];

const PRESETS: ColdStartPresets = {
  inquiry: ["inquiry.balance", "inquiry.history", "transfer.account", "support.call"],
  transfer: ["transfer.account", "transfer.auto", "inquiry.balance", "inquiry.history"],
  invest: ["inquiry.balance", "inquiry.history", "transfer.account", "support.call"],
};

function renderHome(stt?: MockSttProvider) {
  const onAction = vi.fn();
  render(
    <MinUIProvider
      catalog={CATALOG}
      onAction={onAction}
      storage={new MemoryStorageAdapter()}
      coldStartPresets={PRESETS}
      fallback={<p>불러오는 중</p>}
    >
      <MinUIHome catalog={CATALOG} {...(stt ? { stt } : {})} />
    </MinUIProvider>,
  );
  return { onAction };
}

async function openSearch(stt?: MockSttProvider) {
  const handle = renderHome(stt);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /말로 찾기/ })).toBeInTheDocument(),
  );
  await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
  return handle;
}

describe("말로 찾기 화면", () => {
  it("홈 하단에서 열린다", async () => {
    await openSearch();
    expect(screen.getByRole("dialog", { name: "말로 찾기" })).toBeInTheDocument();
  });

  it("음성을 못 쓰는 환경에서도 글로 찾을 수 있다", async () => {
    // stt를 주지 않았다. 음성은 보조 경로이지 유일 경로가 아니다.
    await openSearch();

    expect(screen.queryByRole("button", { name: /눌러서 말하기/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("글로 찾기")).toBeInTheDocument();
  });

  it("Escape로 닫힌다", async () => {
    await openSearch();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "말로 찾기" })).not.toBeInTheDocument();
  });
});

describe("텍스트 검색", () => {
  it("조회성 메뉴는 찾자마자 열린다", async () => {
    const { onAction } = await openSearch();

    await userEvent.type(screen.getByLabelText("글로 찾기"), "잔고");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith("inquiry.balance", undefined));
  });

  it("riskLevel:high 메뉴는 사용자가 눌러야 열린다 (기획안 §9.3) ★", async () => {
    const { onAction } = await openSearch();

    await userEvent.type(screen.getByLabelText("글로 찾기"), "송금");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    // 정확 매칭이지만 자동으로 열리지 않는다.
    expect(onAction).not.toHaveBeenCalled();
    const list = await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(within(list).getByRole("button", { name: /계좌 이체/ })).toBeInTheDocument();

    // 사용자가 눌러야 비로소 열린다.
    await userEvent.click(within(list).getByRole("button", { name: /계좌 이체/ }));
    expect(onAction).toHaveBeenCalledWith("transfer.account", undefined);
  });

  it("못 알아들으면 선택지를 주고 다시 묻는다", async () => {
    await openSearch();

    await userEvent.type(screen.getByLabelText("글로 찾기"), "zzzzz");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    const again = await screen.findByRole("region", { name: "다시 찾기" });
    expect(within(again).getByText(/중에 찾으시는 게 있나요\?/)).toBeInTheDocument();
    // 막다른 길이 아니다 — 고를 것이 함께 온다.
    expect(within(again).getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("되묻기 선택지를 누르면 그것으로 다시 찾는다", async () => {
    await openSearch();
    await userEvent.type(screen.getByLabelText("글로 찾기"), "zzzzz");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    const again = await screen.findByRole("region", { name: "다시 찾기" });
    await userEvent.click(within(again).getAllByRole("button")[0]!);

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "다시 찾기" })).not.toBeInTheDocument(),
    );
  });

  /**
   * 후보 셋 중에서 고르려면 이름만으로는 부족하다. 어디 있는지(경로)와
   * 무엇인지(뜻풀이)가 다른 정보라, 둘 다 있으면 둘 다 준다.
   */
  it("후보에 뜻풀이가 함께 뜬다", async () => {
    await openSearch();

    await userEvent.type(screen.getByLabelText("글로 찾기"), "송금");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    const list = await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(within(list).getByText("다른 사람 계좌로 돈을 보내요")).toBeInTheDocument();
  });

  it("빈 입력으로는 아무 일도 일어나지 않는다", async () => {
    const { onAction } = await openSearch();
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("음성 검색", () => {
  it("들은 말을 화면에 보여 준다 — 마이크가 열린 것을 알 수 있게 (기획안 §11.2)", async () => {
    // holdFinal로 "말하는 중" 상태를 붙잡아 둔다. 실제 발화에서도 중간 결과와
    // 최종 결과 사이에는 시간이 흐른다.
    const stt = new MockSttProvider([
      { partials: ["자동", "자동이체"], text: "자동이체", holdFinal: true },
    ]);
    await openSearch(stt);

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("자동이체"));
    // 버튼 글자도 함께 바뀐다 — 색만으로 알리지 않는다.
    expect(screen.getByRole("button", { name: /듣고 있어요/ })).toBeInTheDocument();
  });

  it("음성으로 찾은 위험 메뉴도 사용자가 눌러야 열린다", async () => {
    const stt = new MockSttProvider([{ text: "돈 보내기" }]);
    const { onAction } = await openSearch(stt);

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("신뢰도가 낮은 인식은 후보를 보여 주지 않고 되묻는다 (기획안 §9.2)", async () => {
    const stt = new MockSttProvider([{ text: "잔고", confidence: 0.2 }]);
    const { onAction } = await openSearch(stt);

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await screen.findByRole("region", { name: "다시 찾기" });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("마이크 권한이 없으면 글로 입력하라고 안내한다", async () => {
    const stt = new MockSttProvider([
      { text: "", error: { code: "permission-denied", message: "거부" } },
    ]);
    await openSearch(stt);

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("글로 입력해 주세요"),
    );
  });
});

describe("axe 자동 검사", () => {
  it("말로 찾기 화면에 위반이 없다", async () => {
    const stt = new MockSttProvider([{ text: "잔고" }]);
    await openSearch(stt);

    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it("후보 목록에도 위반이 없다", async () => {
    await openSearch();
    await userEvent.type(screen.getByLabelText("글로 찾기"), "송금");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));
    await screen.findByRole("region", { name: "찾은 메뉴" });

    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
