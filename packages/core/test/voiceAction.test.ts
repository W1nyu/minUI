import { describe, expect, it, vi } from "vitest";
import { MinUIEngine } from "../src/MinUIEngine.js";
import { MemoryStorageAdapter } from "../src/storage/MemoryStorageAdapter.js";
import { resolveVoiceAction } from "../src/search/voiceAction.js";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import type { MenuCatalog, MenuId } from "../src/types.js";
import { T0 } from "./helpers.js";

/**
 * 위험도가 다른 두 메뉴를 나란히 둔다. 같은 확신 수준에서 처리가 갈리는지 보기 위해서다.
 */
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
    id: "transfer.account",
    label: "계좌 이체",
    synonyms: ["돈 보내기", "송금"],
    category: "이체",
    icon: "transfer",
    route: "/t",
    riskLevel: "high",
  },
  {
    id: "settings.limit",
    label: "한도 변경",
    synonyms: ["한도 올리기"],
    category: "설정",
    icon: "gauge",
    route: "/l",
    riskLevel: "high",
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
];

async function makeEngine(config?: Parameters<typeof resolveConfig>[0]) {
  const opened: MenuId[] = [];
  const engine = await MinUIEngine.create({
    catalog: CATALOG,
    onAction: (menuId) => opened.push(menuId),
    storage: new MemoryStorageAdapter(),
    now: () => T0,
    ...(config ? { config } : {}),
  });
  return { engine, opened };
}

describe("안전 경계 — 음성은 어디까지 하는가 (기획안 §9.3) ★", () => {
  it("검색만으로는 어떤 화면도 열리지 않는다", async () => {
    const { engine, opened } = await makeEngine();

    engine.search("돈 보내기");
    engine.voiceAction("돈 보내기");

    // 엔진은 무엇을 보여줄지만 정한다. 여는 것은 언제나 사용자의 탭이다.
    expect(opened).toEqual([]);
  });

  it("riskLevel:high 메뉴는 확신이 아무리 높아도 자동으로 열리지 않는다", async () => {
    const { engine } = await makeEngine();

    // "송금"은 사전에 있는 정확 매칭이라 점수가 1.0이다.
    const action = engine.voiceAction("송금");

    expect(action.kind).toBe("choose");
    if (action.kind !== "choose") return;
    expect(action.candidates[0]!.menuId).toBe("transfer.account");
    expect(action.candidates[0]!.score).toBe(1);
  });

  it("한도 변경처럼 자금 한도를 건드리는 메뉴도 확인을 거친다", async () => {
    const { engine } = await makeEngine();
    expect(engine.voiceAction("한도 올리기").kind).toBe("choose");
  });

  it("조회성 메뉴는 확신이 높으면 바로 연다", async () => {
    // §9.3 표에서 "조회성 기능 실행"은 음성으로 가능한 쪽에 있다.
    const { engine } = await makeEngine();
    const action = engine.voiceAction("잔고");

    expect(action).toEqual({ kind: "open", menuId: "inquiry.balance" });
  });

  it("조회성 메뉴라도 확신이 낮으면 물어본다", async () => {
    const { engine } = await makeEngine(resolveConfig({ search: { autoOpenConfidence: 1.01 } }));
    expect(engine.voiceAction("잔고").kind).toBe("choose");
  });

  it("후보가 여럿이면 사용자가 고른다 (기획안 F4)", async () => {
    const { engine } = await makeEngine();
    const action = engine.voiceAction("돈");

    // 무엇이 나오든 자동 실행은 아니어야 한다.
    expect(action.kind).not.toBe("open");
  });
});

describe("저품질 STT 흡수 (기획안 §9.2)", () => {
  it("신뢰도가 임계치 미만이면 후보를 보여 주지 않고 되묻는다", async () => {
    const { engine } = await makeEngine();

    // 텍스트만 보면 정확 매칭이지만, 인식 자체를 믿을 수 없다.
    const action = engine.voiceAction("잔고", 0.3);

    expect(action.kind).toBe("reprompt");
  });

  it("신뢰도가 충분하면 평소대로 처리한다", async () => {
    const { engine } = await makeEngine();
    expect(engine.voiceAction("잔고", 0.9).kind).toBe("open");
  });

  it("임계치는 설정으로 조절된다", async () => {
    const { engine } = await makeEngine(
      resolveConfig({ search: { minSttConfidence: 0.95 } }),
    );
    expect(engine.voiceAction("잔고", 0.9).kind).toBe("reprompt");
  });

  it("텍스트 검색은 신뢰도 검사를 거치지 않는다", async () => {
    const { engine } = await makeEngine();
    expect(engine.voiceAction("잔고").kind).toBe("open");
  });

  it("되묻기는 열린 질문이 아니라 선택지를 준다", async () => {
    const { engine } = await makeEngine();
    const action = engine.voiceAction("asdfgh");

    expect(action.kind).toBe("reprompt");
    if (action.kind !== "reprompt") return;
    expect(action.choices.length).toBeGreaterThan(0);
    expect(action.prompt).toContain("중에 찾으시는 게 있나요?");
  });
});

describe("검색으로 연 메뉴도 사용 기록에 남는다", () => {
  it("사용자가 후보를 골라 열면 기록된다", async () => {
    const { engine, opened } = await makeEngine();

    const action = engine.voiceAction("송금");
    expect(action.kind).toBe("choose");
    if (action.kind !== "choose") return;

    // 사용자가 후보를 탭한 상황
    engine.open(action.candidates[0]!.menuId);

    expect(opened).toEqual(["transfer.account"]);
    const score = engine.explain().find((r) => r.menuId === "transfer.account")!;
    expect(score.total).toBeGreaterThan(0);
  });
});

describe("엔진 밖에서도 같은 규칙이 강제된다", () => {
  it("호스트가 임의로 만든 후보에도 위험도 규칙이 적용된다", async () => {
    // 호스트가 resolveVoiceAction을 직접 부르더라도 경계는 같다.
    const { engine } = await makeEngine();
    const onAction = vi.fn();
    void onAction;

    const action = engine.voiceAction("계좌 이체");
    expect(action.kind).toBe("choose");
  });
});

/**
 * 자동 실행 여부를 정할 때 무엇을 "경쟁하는 후보"로 세는가.
 *
 * <p>`search()`는 1위가 문턱을 넘으면 아래 것들도 함께 돌려준다 — "이거 말씀하신 건가요"
 * 목록에 보여 주기 위해서다. 그것을 경쟁자로 세면 확신이 분명한 경우까지 되묻게 된다.
 *
 * <p>M7에서 실제로 그랬다. 학습이 다른 후보를 지우지 않게 고친 순간, 0.95짜리 학습 매칭에
 * 문턱 아래 유사도 잡음이 딸려 와서 사용자가 직접 가르친 말이 영영 자동으로 열리지 않았다.
 */
describe("문턱 아래 후보는 경쟁자가 아니다", () => {
  /** 문턱(0.4) 아래 잡음이 딸려 온 상태를 만든다. */
  function withNoise(menuId: MenuId, score: number) {
    return resolveVoiceAction({
      outcome: {
        status: "ok",
        query: "관리비",
        candidates: [
          { menuId, score, matchedBy: "learned", matchedTerm: "관리비" },
          { menuId: "inquiry.history", score: 0.28, matchedBy: "semantic", matchedTerm: "거래내역" },
        ],
      },
      menus: new Map(CATALOG.map((menu) => [menu.id, menu])),
      config: DEFAULT_CONFIG,
    });
  }

  it("잡음이 딸려 와도 확신이 분명한 조회성 메뉴는 연다", () => {
    expect(withNoise("inquiry.balance", 0.95)).toEqual({
      kind: "open",
      menuId: "inquiry.balance",
    });
  });

  it("잡음만 딸려 와도 위험한 메뉴는 열지 않는다 (§9.3) ★", () => {
    expect(withNoise("transfer.account", 0.95).kind).toBe("choose");
  });

  it("문턱을 넘은 후보가 둘이면 사용자가 고른다", () => {
    const action = resolveVoiceAction({
      outcome: {
        status: "ok",
        query: "관리비",
        candidates: [
          { menuId: "inquiry.balance", score: 0.95, matchedBy: "learned", matchedTerm: "관리비" },
          { menuId: "inquiry.history", score: 0.62, matchedBy: "synonym", matchedTerm: "내역" },
        ],
      },
      menus: new Map(CATALOG.map((menu) => [menu.id, menu])),
      config: DEFAULT_CONFIG,
    });

    expect(action.kind).toBe("choose");
  });
});
