import { MemoryStorageAdapter, type ColdStartPresets, type MenuCatalog } from "@minui/core";
import { MockSttProvider } from "@minui/voice";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { MinUIHome } from "../src/MinUIHome.js";
import { MinUIProvider } from "../src/MinUIProvider.js";
import type { SttLike } from "../src/VoiceSearchSheet.js";

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

interface HomeExtras {
  retrieve?: (query: string) => Promise<readonly { menuId: string; score: number }[]>;
  assist?: (query: string, candidates: string[]) => Promise<string | null>;
  neural?: Record<string, unknown>;
  nbest?: Record<string, unknown>;
  bias?: Record<string, unknown>;
}

function renderHome(stt?: MockSttProvider, extras: HomeExtras = {}) {
  const onAction = vi.fn();
  const { retrieve, assist, neural, nbest, bias } = extras;
  const search = {
    ...(neural ? { neural: { enabled: true, ...neural } } : {}),
    ...(nbest ? { nbest: { enabled: true, ...nbest } } : {}),
    ...(bias ? { bias: { enabled: true, ...bias } } : {}),
  };
  render(
    <MinUIProvider
      catalog={CATALOG}
      onAction={onAction}
      storage={new MemoryStorageAdapter()}
      coldStartPresets={PRESETS}
      fallback={<p>불러오는 중</p>}
      {...(retrieve ? { retrieve } : {})}
      {...(assist ? { assist } : {})}
      {...(Object.keys(search).length > 0 ? { config: { search } } : {})}
    >
      <MinUIHome catalog={CATALOG} {...(stt ? { stt } : {})} />
    </MinUIProvider>,
  );
  return { onAction };
}

async function openSearch(stt?: MockSttProvider, extras: HomeExtras = {}) {
  const handle = renderHome(stt, extras);
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
    /*
     * 버튼 글자도 함께 바뀐다 — 색만으로 알리지 않는다.
     * MockSttProvider는 끝을 알려야 하는 엔진(`finish`)이라 "다 말했어요"가 된다.
     * 스스로 끝나는 엔진에서는 "듣고 있어요"로 남는다 — 아래 별도 테스트가 잰다.
     */
    expect(screen.getByRole("button", { name: /다 말했어요/ })).toBeInTheDocument();
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

  it("대안을 주지 않는 엔진에서도 지금까지와 똑같이 돈다 (M21)", async () => {
    const stt = new MockSttProvider([{ text: "돈 보내기" }]);
    const { onAction } = await openSearch(stt, { nbest: {} });

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("1순위를 헛들어도 대안에 있으면 찾아낸다 (M21)", async () => {
    const stt = new MockSttProvider([
      { text: "날씨 어때", alternatives: ["돈 보내기"] },
    ]);
    await openSearch(stt, { nbest: {} });

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await screen.findByRole("region", { name: "찾은 메뉴" });
  });

  it("대안에서 온 위험 메뉴도 사용자가 눌러야 열린다 ★ (M21)", async () => {
    // §9.3의 안전 경계는 어느 가설에서 왔든 똑같이 걸린다.
    const stt = new MockSttProvider([
      { text: "날씨 어때", alternatives: ["돈 보내기"] },
    ]);
    const { onAction } = await openSearch(stt, { nbest: {} });

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("대안을 꺼 두면 1순위만 본다 — 스위치가 실제로 가른다 (M21)", async () => {
    const stt = new MockSttProvider([
      { text: "날씨 어때", alternatives: ["돈 보내기"] },
    ]);
    // 기본값이 켜져 있으므로(2026-09-05) 끈 상태를 직접 만든다.
    await openSearch(stt, { nbest: { enabled: false } });

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await screen.findByRole("region", { name: "다시 찾기" });
  });

  it("마이크를 열기 전에 카탈로그를 인식기에 알려 준다 (M22)", async () => {
    const stt = new MockSttProvider([{ text: "돈 보내기" }]);
    await openSearch(stt, { bias: {} });

    expect(stt.phrases).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    expect(stt.phrases.length).toBeGreaterThan(0);
    // 정규화된 형태가 아니라 사람이 말하는 원문이어야 한다.
    expect(stt.phrases.map((p) => p.phrase)).toContain("계좌 이체");
    for (const { boost } of stt.phrases) {
      expect(boost).toBeGreaterThanOrEqual(0);
      expect(boost).toBeLessThanOrEqual(10);
    }
  });

  it("★ 편향에 개인 학습어를 넣지 않는다 — 기기를 떠나면 안 되는 값이다 (M22)", async () => {
    const stt = new MockSttProvider([{ text: "돈 보내기" }]);
    await openSearch(stt, { bias: {} });
    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    // 카탈로그에 없는 말은 하나도 나가지 않는다.
    const known = new Set(CATALOG.flatMap((menu) => [menu.label, ...(menu.synonyms ?? [])]));
    for (const { phrase } of stt.phrases) expect(known.has(phrase)).toBe(true);
  });

  it("편향을 켜지 않으면 아무것도 넘기지 않는다 — 기본 동작이 바뀌지 않는다 (M22)", async () => {
    const stt = new MockSttProvider([{ text: "돈 보내기" }]);
    await openSearch(stt);
    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    expect(stt.phrases).toHaveLength(0);
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

/**
 * 말이 끝나는 시점을 사용자가 정한다.
 *
 * 처음에는 온디바이스 Whisper 때문에 생긴 화면이었다 — 스스로 끝나지 못하는 엔진이라
 * 누군가 끝을 알려 줘야 했다. M11에서 그 엔진을 뺐지만 **화면은 그대로 둔다.**
 * 남긴 이유가 엔진이 아니라 사람 쪽에 있어서다: 조용히 말하거나 말끝을 흐리면 인식기가
 * 끊을 때까지 기다려야 하고, 고령 사용자가 정확히 그렇게 말한다 (기획안 §9.2).
 *
 * 여기서 재는 것은 **화면이 `finish`의 유무에 따라 갈리는가**이고, 실제 엔진이 그것을
 * 주는지는 `packages/voice`(native stop 호출)와 `frontend`(F9 프로토콜 배선)가 각각 잰다.
 * 두 방식이 같은 화면에서 돌아야 한다는 요구는 그대로다.
 */
describe("말이 끝나는 시점을 사용자가 정하는 엔진", () => {
  it("듣는 중에는 끝내는 버튼이 된다", async () => {
    const stt = new MockSttProvider([{ partials: ["자동"], text: "자동이체", holdFinal: true }]);
    await openSearch(stt);

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /다 말했어요/ })).toBeInTheDocument(),
    );
  });

  it("끝내는 버튼을 누르면 그제야 결과가 나온다", async () => {
    const stt = new MockSttProvider([{ partials: ["잔고"], text: "잔고", holdFinal: true }]);
    const { onAction } = await openSearch(stt);

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /다 말했어요/ })).toBeInTheDocument(),
    );
    expect(onAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /다 말했어요/ }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith("inquiry.balance", undefined));
  });

  /** 스스로 확정하는 엔진에서는 끝내라고 시키지 않는다. */
  it("스스로 끝나는 엔진에서는 끝내는 버튼을 만들지 않는다", async () => {
    const stt = new MockSttProvider([{ text: "잔고" }]);
    const noFinish: SttLike = {
      isSupported: true,
      start: () => stt.start(),
      stop: () => stt.stop(),
      onPartial: (cb) => stt.onPartial(cb),
      onFinal: (cb) => stt.onFinal(cb),
      onError: (cb) => stt.onError(cb),
    };
    const { onAction } = await openSearch(noFinish as MockSttProvider);

    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith("inquiry.balance", undefined));
    expect(screen.queryByRole("button", { name: /다 말했어요/ })).not.toBeInTheDocument();
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

/**
 * 개인 동의어 학습 (M7) — 화면을 통해서만 잰다.
 *
 * <p>엔진을 직접 찔러 보지 않는 이유: 이 기능이 실제로 값을 하려면 <b>사용자가 실제로
 * 밟는 경로</b>에서 배워야 한다. 되묻기를 만나 갈래를 타고 들어가 끝내 찾아낸 그 길이
 * 바로 배울 값이 있는 길이고, 엔진 API만 검사하면 그 배선이 끊겨도 초록이 뜬다.
 */
describe("메뉴가 내 말을 배운다 (M7)", () => {
  /** 되묻기 → 갈래 → 메뉴. 검색이 못 알아들었지만 사용자가 끝내 도달하는 길. */
  async function findTheHardWay(query: string, category: string, label: string) {
    await userEvent.type(screen.getByLabelText("글로 찾기"), query);
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    const reprompt = await screen.findByRole("region", { name: "다시 찾기" });
    await userEvent.click(within(reprompt).getByRole("button", { name: category }));

    const found = await screen.findByRole("region", { name: "찾은 메뉴" });
    await userEvent.click(within(found).getByRole("button", { name: new RegExp(label) }));
  }

  it("한 번 헤맨 말을 다음에는 알아듣는다", async () => {
    const { onAction } = await openSearch();

    // ① 검색이 모르는 말이다. 되묻기를 거쳐 갈래로 찾아 들어간다.
    await findTheHardWay("관리비", "조회", "거래 내역");
    expect(onAction).toHaveBeenCalledWith("inquiry.history", undefined);

    // ② 같은 말로 다시 찾는다. 이번에는 후보로 나온다.
    await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
    await userEvent.type(screen.getByLabelText("글로 찾기"), "관리비");
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));

    const found = await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(within(found).getByRole("button", { name: /거래 내역/ })).toBeInTheDocument();
  });

  /*
   * §9.3은 학습과 무관하게 성립해야 한다. 배운 말로 위험한 메뉴를 불러도 자동으로
   * 열리지 않는다 — 이 경계가 학습으로 뚫리면 "말로 이체가 실행되는" 경로가 생긴다.
   */
  it("배운 말이라도 위험한 메뉴는 눌러야 열린다 ★", async () => {
    const { onAction } = await openSearch();

    await findTheHardWay("관리비", "이체", "자동이체 관리");
    onAction.mockClear();

    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
      await userEvent.type(screen.getByLabelText("글로 찾기"), "관리비");
      await userEvent.click(screen.getByRole("button", { name: "찾기" }));

      const found = await screen.findByRole("region", { name: "찾은 메뉴" });
      expect(onAction).not.toHaveBeenCalled();
      await userEvent.click(within(found).getByRole("button", { name: /자동이체 관리/ }));
      onAction.mockClear();
    }
  });
});

/**
 * 원격 → 로컬 → 도우미. 세 겹이고 위의 둘은 없어도 된다 (M11).
 *
 * <p>여기가 재는 것은 <b>층이 무너지는 방식</b>이다. 원격이 늦거나 죽어도 화면은
 * 되묻기로 돌아가야 하고, 원격이 찾아 준 것도 사용자가 눌러야 열려야 한다.
 */
describe("원격 신경망 검색 (M11)", () => {
  /**
   * **다이얼로그 안만 본다.**
   *
   * <p>처음에는 `screen`으로 찾다가 테스트가 구현 없이 통과했다 — 콜드 스타트 카드가
   * 다이얼로그 뒤 홈에 같은 이름으로 떠 있었고 그것을 잡고 있었다. 후보인지 카드인지
   * 구분하지 못하는 검사는 아무것도 재지 않는다.
   */
  function sheet() {
    return within(screen.getByRole("dialog", { name: "말로 찾기" }));
  }

  async function search(text: string) {
    await userEvent.type(screen.getByLabelText("글로 찾기"), text);
    await userEvent.click(screen.getByRole("button", { name: "찾기" }));
  }

  it("원격이 데려온 것을 후보로 보여 준다", async () => {
    // "돈 부쳐"는 로컬에서 되묻기로 끝난다 — 아래 마지막 테스트가 그것을 고정한다.
    await openSearch(undefined, {
      retrieve: async () => [{ menuId: "transfer.account", score: 0.95 }],
      neural: {},
    });

    await search("돈 부쳐");

    await waitFor(() =>
      expect(sheet().getByRole("button", { name: /계좌 이체/ })).toBeInTheDocument(),
    );
  });

  it("원격이 찾아 줘도 사용자가 눌러야 열린다", async () => {
    // 규칙 8의 일반형 — 모델은 위험도도 확신도 올리지 못한다.
    const { onAction } = await openSearch(undefined, {
      retrieve: async () => [{ menuId: "inquiry.balance", score: 1 }],
      neural: {},
    });

    await search("돈 부쳐");

    await waitFor(() =>
      expect(sheet().getByRole("button", { name: /잔액 보기/ })).toBeInTheDocument(),
    );
    expect(onAction).not.toHaveBeenCalled();
  });

  it("원격이 죽어도 되묻기 화면이 그대로 뜬다", async () => {
    await openSearch(undefined, {
      retrieve: () => Promise.reject(new Error("서버 없음")),
      neural: {},
    });

    await search("돈 부쳐");

    await waitFor(() =>
      expect(sheet().getByText(/중에 찾으시는 게 있나요/)).toBeInTheDocument(),
    );
  });

  it("원격이 늦으면 기다리지 않는다 — 상한은 화면이 씌운다", async () => {
    /*
     * core는 시간을 재지 않는다(불변 규칙 1 — `portability.test.ts`가 강제한다).
     * 시계를 가진 층이 재야 하고, 그 층이 여기다. 고령 사용자에게 침묵은 고장이다.
     */
    await openSearch(undefined, {
      retrieve: () => new Promise(() => {}), // 영영 안 온다
      neural: { timeoutMs: 20 },
    });

    await search("돈 부쳐");

    await waitFor(() =>
      expect(sheet().getByText(/중에 찾으시는 게 있나요/)).toBeInTheDocument(),
    );
  });

  it("retrieve가 없는 호스트에서 지금까지와 똑같이 돈다", async () => {
    await openSearch();

    await search("돈 부쳐");

    await waitFor(() =>
      expect(sheet().getByText(/중에 찾으시는 게 있나요/)).toBeInTheDocument(),
    );
  });
});
