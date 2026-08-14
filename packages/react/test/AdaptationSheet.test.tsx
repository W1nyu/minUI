import { MemoryStorageAdapter, type ColdStartPresets, type MenuCatalog } from "@minui/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { MinUIHome } from "../src/MinUIHome.js";
import { MinUIProvider } from "../src/MinUIProvider.js";

/**
 * 적응했다는 것을 사용자가 알 수 있게 (M8).
 *
 * <p>개인화가 조용한 것은 P3의 목적이지만, **물어봤을 때 답하지 못하면 그것은 조용한 게
 * 아니라 깜깜한 것이다.** 화면이 왜 이렇게 생겼는지, 무엇을 배웠는지, 그리고 그것을
 * 어떻게 되돌리는지가 한 화면에 있어야 한다.
 *
 * <p>M7이 저장을 시작해 놓고 지울 길을 주지 않은 상태였다. 여기가 그 길이다.
 */

const CATALOG: MenuCatalog = [
  {
    id: "inquiry.balance",
    label: "잔액 보기",
    synonyms: ["잔고"],
    category: "조회",
    icon: "wallet",
    route: "/b",
    riskLevel: "low",
  },
  {
    id: "inquiry.history",
    label: "거래 내역",
    synonyms: ["입금 확인"],
    category: "조회",
    icon: "list",
    route: "/h",
    riskLevel: "low",
  },
  {
    id: "transfer.account",
    label: "계좌 이체",
    synonyms: ["송금"],
    category: "이체",
    icon: "transfer",
    route: "/t",
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
  transfer: ["transfer.account", "inquiry.balance", "inquiry.history", "support.call"],
  invest: ["inquiry.balance", "inquiry.history", "transfer.account", "support.call"],
};

/** `liveReorder`를 켠다 — 몇 번 눌러서 이유가 바뀌는 것을 한 세션에서 보기 위해서다. */
function renderHome() {
  const onAction = vi.fn();
  render(
    <MinUIProvider
      catalog={CATALOG}
      onAction={onAction}
      storage={new MemoryStorageAdapter()}
      coldStartPresets={PRESETS}
      config={{ stability: { liveReorder: true } }}
      fallback={<p>불러오는 중</p>}
    >
      <MinUIHome catalog={CATALOG} />
    </MinUIProvider>,
  );
  return { onAction };
}

async function openSheet() {
  const handle = renderHome();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /왜 이렇게 보이나요/ })).toBeInTheDocument(),
  );
  await userEvent.click(screen.getByRole("button", { name: /왜 이렇게 보이나요/ }));
  return handle;
}

/** 되묻기 → 갈래 → 메뉴. M7이 학습하는 유일한 경로. */
async function teach(query: string, category: string, label: string) {
  await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
  await userEvent.type(screen.getByLabelText("글로 찾기"), query);
  await userEvent.click(screen.getByRole("button", { name: "찾기" }));

  const reprompt = await screen.findByRole("region", { name: "다시 찾기" });
  await userEvent.click(within(reprompt).getByRole("button", { name: category }));
  const found = await screen.findByRole("region", { name: "찾은 메뉴" });
  await userEvent.click(within(found).getByRole("button", { name: new RegExp(label) }));
}

describe("여는 길", () => {
  it("홈에서 열린다", async () => {
    await openSheet();
    expect(screen.getByRole("dialog", { name: "왜 이렇게 보이나요" })).toBeInTheDocument();
  });

  /*
   * 카드에 없는 기능으로 가는 길은 "말로 찾기"와 "전체 메뉴" 둘뿐이어야 한다 (원칙 P2).
   * 이 화면은 기능으로 가는 길이 아니라 **설명**이므로 그 두 자리를 건드리지 않는다.
   */
  it("나가는 길 두 개를 밀어내지 않는다", async () => {
    renderHome();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /말로 찾기/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /전체 메뉴/ })).toBeInTheDocument();
  });

  it("Escape로 닫힌다", async () => {
    await openSheet();
    await userEvent.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "왜 이렇게 보이나요" }),
    ).not.toBeInTheDocument();
  });
});

describe("카드가 왜 여기 있는가", () => {
  it("기록이 없으면 처음 그대로라고 말한다", async () => {
    await openSheet();

    const cards = screen.getByRole("region", { name: "지금 홈에 있는 카드" });
    expect(within(cards).getAllByText(/처음 화면 그대로/).length).toBeGreaterThan(0);
  });

  it("쓴 카드는 몇 번 썼는지 말한다", async () => {
    await openSheet();
    await userEvent.keyboard("{Escape}");

    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getByRole("button", { name: /잔액 보기/ }));
    }

    await userEvent.click(screen.getByRole("button", { name: /왜 이렇게 보이나요/ }));
    const cards = screen.getByRole("region", { name: "지금 홈에 있는 카드" });
    expect(within(cards).getByText(/3번/)).toBeInTheDocument();
  });

  /*
   * 사용자가 직접 한 일이 자동 판단보다 먼저 설명돼야 한다. 많이 쓴 카드를 고정했을 때
   * "많이 쓰셔서요"라고 답하면 사용자가 한 일이 화면에서 지워진다.
   */
  it("고정한 카드는 고정이 이유다", async () => {
    await openSheet();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: /전체 메뉴/ }));
    const rows = await screen.findAllByRole("button", { name: "홈에 고정" });
    await userEvent.click(rows[0]!);
    await userEvent.click(screen.getByRole("button", { name: /돌아가기/ }));

    await userEvent.click(screen.getByRole("button", { name: /왜 이렇게 보이나요/ }));
    const cards = screen.getByRole("region", { name: "지금 홈에 있는 카드" });
    expect(within(cards).getByText(/직접 고정/)).toBeInTheDocument();
  });
});

describe("배운 말 — M7이 남긴 숙제", () => {
  it("아무것도 안 배웠으면 그렇게 말한다", async () => {
    await openSheet();

    const learned = screen.getByRole("region", { name: "제가 배운 말" });
    expect(within(learned).getByText(/아직 배운 말이 없어요/)).toBeInTheDocument();
  });

  it("배운 말과 그 말이 가리키는 메뉴를 보여 준다", async () => {
    await openSheet();
    await userEvent.keyboard("{Escape}");

    await teach("관리비", "조회", "거래 내역");

    await userEvent.click(screen.getByRole("button", { name: /왜 이렇게 보이나요/ }));
    const learned = screen.getByRole("region", { name: "제가 배운 말" });
    expect(within(learned).getByText(/관리비/)).toBeInTheDocument();
    expect(within(learned).getByText(/거래 내역/)).toBeInTheDocument();
  });

  /*
   * **이 테스트가 M8의 존재 이유다.** M7은 한 번 잘못 배우면 되돌릴 길이 없었다 —
   * 후보가 하나뿐이면 사용자는 누르지 않고 창을 닫고, 그러면 올바른 학습도 일어나지
   * 않은 채 망각 기한까지 남는다.
   */
  it("하나를 잊게 할 수 있고, 잊으면 검색도 원래대로 돌아간다", async () => {
    await openSheet();
    await userEvent.keyboard("{Escape}");
    await teach("관리비", "조회", "거래 내역");

    await userEvent.click(screen.getByRole("button", { name: /왜 이렇게 보이나요/ }));
    const learned = screen.getByRole("region", { name: "제가 배운 말" });
    // "전부 잊어버리기"까지 걸리지 않게 그 말만 콕 집는다.
    await userEvent.click(
      within(learned).getByRole("button", { name: "“관리비” 잊어버리기" }),
    );

    expect(within(learned).getByText(/아직 배운 말이 없어요/)).toBeInTheDocument();

    // 검색도 배우기 전으로 돌아간다.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
    await userEvent.type(screen.getByLabelText("글로 찾기"), "관리비");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));
    expect(await screen.findByRole("region", { name: "다시 찾기" })).toBeInTheDocument();
  });

  it("전부 잊게 할 수 있다", async () => {
    await openSheet();
    await userEvent.keyboard("{Escape}");
    await teach("관리비", "조회", "거래 내역");
    await teach("빌린돈", "설정", "전화 상담");

    await userEvent.click(screen.getByRole("button", { name: /왜 이렇게 보이나요/ }));
    const learned = screen.getByRole("region", { name: "제가 배운 말" });
    await userEvent.click(within(learned).getByRole("button", { name: "전부 잊어버리기" }));
    await userEvent.click(within(learned).getByRole("button", { name: /네, 전부 지울게요/ }));

    expect(within(learned).getByText(/아직 배운 말이 없어요/)).toBeInTheDocument();
  });

  /*
   * 지우는 버튼이 실수로 눌리기 쉬우면 그것도 문제다. 다만 확인 창(confirm)은 쓰지 않는다 —
   * 고령 사용자에게 모달 위의 모달은 그 자체가 막다른 길이고, 되돌릴 수 없는 것은
   * "전부"뿐이라 그것만 두 단계로 만든다.
   */
  it("전부 잊기는 한 번 더 확인한다", async () => {
    await openSheet();
    await userEvent.keyboard("{Escape}");
    await teach("관리비", "조회", "거래 내역");

    await userEvent.click(screen.getByRole("button", { name: /왜 이렇게 보이나요/ }));
    const learned = screen.getByRole("region", { name: "제가 배운 말" });

    await userEvent.click(within(learned).getByRole("button", { name: "전부 잊어버리기" }));
    // 첫 누름은 확인을 띄우고, 그 사이에는 아직 지워지지 않는다.
    expect(within(learned).getByText(/관리비/)).toBeInTheDocument();

    await userEvent.click(within(learned).getByRole("button", { name: /네, 전부 지울게요/ }));
    expect(within(learned).getByText(/아직 배운 말이 없어요/)).toBeInTheDocument();
  });
});

describe("검색 후보에 근거를 보여 준다", () => {
  it("배운 말로 찾았으면 그렇게 적는다", async () => {
    renderHome();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /말로 찾기/ })).toBeInTheDocument(),
    );

    await teach("관리비", "조회", "거래 내역");

    await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
    await userEvent.type(screen.getByLabelText("글로 찾기"), "관리비");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    const found = await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(within(found).getByText(/전에 이렇게 찾으셨어요/)).toBeInTheDocument();
  });

  it("사전에 있던 말로 찾았을 때는 적지 않는다", async () => {
    renderHome();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /말로 찾기/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
    await userEvent.type(screen.getByLabelText("글로 찾기"), "송금");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    const found = await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(within(found).queryByText(/전에 이렇게 찾으셨어요/)).not.toBeInTheDocument();
  });
});

describe("axe 자동 검사", () => {
  it("설명 화면에 위반이 없다", async () => {
    await openSheet();

    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
