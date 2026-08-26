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

/**
 * 음성 프리필 (M9, 기획안 §9.3).
 *
 * <p>§9.3이 허용한 것은 <b>"메뉴 호출과 화면 프리필"까지</b>다. 값이 미리 채워진 화면이
 * 열리는 것과 그 값으로 무언가가 실행되는 것은 다르고, 그 사이에는 언제나 사용자의 탭이
 * 있어야 한다.
 *
 * <p>엔진이 값을 뽑지는 않는다 — 무엇이 수취인이고 무엇이 금액인지는 호스트만 안다.
 * 엔진이 지키는 것은 <b>프리필이 안전 경계를 넘지 않는다</b>는 것 하나다.
 */
describe("음성 프리필 (M9) ★", () => {
  /** 호스트가 주는 추출기. 여기서는 "엄마"만 알아본다고 치자. */
  const slots = (query: string) =>
    query.includes("엄마") ? { payee: "엄마" } : {};

  async function withSlots() {
    const opened: { menuId: MenuId; params?: Record<string, unknown> }[] = [];
    const engine = await MinUIEngine.create({
      catalog: CATALOG,
      onAction: (menuId, params) => opened.push({ menuId, ...(params ? { params } : {}) }),
      storage: new MemoryStorageAdapter(),
      now: () => T0,
      slots,
    });
    return { engine, opened };
  }

  /*
   * **프리필이 붙은 자동 실행은 드물다.** 말에 군더더기가 하나라도 붙으면 정확 매칭이
   * 깨져 점수가 `autoOpenConfidence`(0.9)에 못 미치고, 그러면 후보 제시로 간다.
   * 실제로 여기까지 오는 것은 사용자가 그 말로 두 번 이상 도달해 <b>엔진이 배운</b>
   * 경우다(M7). 두 마일스톤이 만나는 자리이므로 그 경로로 잰다.
   */
  it("배운 말로 조회성 메뉴가 바로 열릴 때 미리 채울 값이 함께 온다", async () => {
    const { engine } = await withSlots();

    // 두 번 도달해야 학습 점수가 자동 실행 문턱(0.9)에 닿는다.
    engine.noteSearchChoice("엄마 용돈", "inquiry.balance");
    engine.noteSearchChoice("엄마 용돈", "inquiry.balance");

    expect(engine.voiceAction("엄마 용돈")).toEqual({
      kind: "open",
      menuId: "inquiry.balance",
      prefill: { payee: "엄마" },
    });
  });

  it("배우기 전에는 열리지 않고, 그때는 프리필도 붙지 않는다", async () => {
    const { engine } = await withSlots();

    const action = engine.voiceAction("엄마 용돈");

    expect(action.kind).toBe("reprompt");
    expect(action).not.toHaveProperty("prefill");
  });

  /*
   * **이 테스트가 M9의 경계다.** 프리필이 붙었다고 자동 실행이 열리면, "엄마한테
   * 보내줘" 한마디로 수취인이 채워진 이체 화면이 저절로 뜨게 된다. §9.3이 막는 것이
   * 정확히 그 경로다 — 옆에서 시키는 대로 말하게 하는 공격에 문이 열린다.
   */
  it("위험한 메뉴는 프리필이 있어도 자동으로 열리지 않는다", async () => {
    const { engine, opened } = await withSlots();

    const action = engine.voiceAction("엄마한테 송금");

    expect(action.kind).toBe("choose");
    expect(opened).toEqual([]);
  });

  /*
   * 못 알아들은 발화에서 뽑은 값은 근거가 없다. 되묻는 화면에 프리필을 실어 보내면
   * 호스트가 그것을 쓸 수 있게 되고, 그러면 "무엇을 여는지도 모르는데 값은 안다"는
   * 이상한 상태가 된다.
   */
  it("되묻기에는 프리필이 붙지 않는다", async () => {
    const { engine } = await withSlots();

    const action = engine.voiceAction("엄마 날씨");

    expect(action.kind).toBe("reprompt");
    expect(action).not.toHaveProperty("prefill");
  });

  it("추출기를 주지 않은 호스트에서는 아무것도 달라지지 않는다", async () => {
    const { engine } = await makeEngine();

    expect(engine.voiceAction("잔고")).toEqual({
      kind: "open",
      menuId: "inquiry.balance",
    });
  });

  it("호스트가 고른 뒤에도 같은 값을 다시 물을 수 있다", async () => {
    const { engine } = await withSlots();

    // 후보 목록에서 사용자가 고른 시점에 호스트가 부른다.
    expect(engine.prefillFor("엄마한테 송금", "transfer.account")).toEqual({
      payee: "엄마",
    });
  });

  it("카탈로그에 없는 메뉴에는 값을 주지 않는다", async () => {
    const { engine } = await withSlots();
    expect(engine.prefillFor("엄마한테 송금", "없는메뉴")).toEqual({});
  });

  /*
   * 호스트 코드가 던져도 음성 경로가 죽으면 안 된다. 프리필은 편의이지 기능의
   * 전제가 아니다 — 도우미가 죽어도 서비스가 도는 것과 같은 판단이다.
   */
  it("추출기가 던져도 메뉴는 열린다", async () => {
    const engine = await MinUIEngine.create({
      catalog: CATALOG,
      onAction: () => {},
      storage: new MemoryStorageAdapter(),
      now: () => T0,
      slots: () => {
        throw new Error("호스트 버그");
      },
    });

    expect(engine.voiceAction("잔고")).toEqual({
      kind: "open",
      menuId: "inquiry.balance",
    });
  });
});

/**
 * 모델이 올린 후보는 자동으로 열리지 않는다 (M11).
 *
 * <p>불변 규칙 8("LLM은 위험도를 낮추지 못한다")의 일반형이다 — <b>모델은 확신도 올리지
 * 못한다.</b> 화면은 이미 그렇게 하고 있었다: 도우미가 고른 것도 후보로만 제시한다
 * (`VoiceSearchSheet.tsx`). 그 판단을 화면이 아니라 규칙이 있는 자리로 옮긴다.
 *
 * <p>이 한 줄이 위험 하나를 통째로 없앤다. 원격 모델의 점수 분포는 로컬과 다른데,
 * 자동 실행이 원천 차단되므로 <b>`autoOpenConfidence`(0.9)를 다시 튜닝할 필요가 없다.</b>
 */
describe("원격이 올린 후보 (M11)", () => {
  it("확신이 1.0이어도 자동으로 열리지 않는다", () => {
    const action = resolveVoiceAction({
      outcome: {
        status: "ok",
        query: "돈보내다",
        candidates: [
          { menuId: "inquiry.balance", score: 1, matchedBy: "neural", matchedTerm: "돈보내다" },
        ],
      },
      menus: new Map(CATALOG.map((menu) => [menu.id, menu])),
      config: DEFAULT_CONFIG,
    });

    expect(action.kind).toBe("choose");
  });

  it("사람이 붙인 동의어는 지금까지처럼 자동으로 열린다 — 회귀 없음", () => {
    // 이 테스트가 없으면 위 규칙이 조용히 모든 자동 실행을 막아도 눈치채지 못한다.
    const action = resolveVoiceAction({
      outcome: {
        status: "ok",
        query: "잔고",
        candidates: [
          { menuId: "inquiry.balance", score: 0.95, matchedBy: "synonym", matchedTerm: "잔고" },
        ],
      },
      menus: new Map(CATALOG.map((menu) => [menu.id, menu])),
      config: DEFAULT_CONFIG,
    });

    expect(action.kind).toBe("open");
  });
});

/**
 * 민감한 조회는 자동으로 열리지 않는다 (M11 Task 20′).
 *
 * <p>지금 `riskLevel`은 <b>돈이 움직이는가</b>만 본다. 그래서 잔액·거래내역처럼 읽기만
 * 하는 화면은 `low`이고, 확신 0.9 이상이면 <b>확인 없이 열린다.</b>
 *
 * <p>잠금 해제된 기기를 잠깐 쥔 사람이 "잔액 얼마야"로 볼 수 있다는 뜻이다.
 * <b>돈은 안 나가지만 정보는 나간다.</b> §9.3의 위협 모형에서 "안 막힌다"로 남아 있던 칸이다.
 *
 * <p>`high`로 올리지 않고 `medium`을 쓰는 이유: `high`는 "음성으로 완료 불가"라는 뜻이고
 * 조회는 애초에 완료할 것이 없다. 둘을 같은 칸에 넣으면 <b>왜 막혔는지</b>가 흐려진다.
 */
describe("민감한 조회 (M11)", () => {
  function actionFor(riskLevel: "low" | "medium" | "high") {
    const menus = new Map(
      CATALOG.map((menu) => [
        menu.id,
        menu.id === "inquiry.balance" ? { ...menu, riskLevel } : menu,
      ]),
    );
    return resolveVoiceAction({
      outcome: {
        status: "ok",
        query: "잔고",
        candidates: [
          { menuId: "inquiry.balance", score: 0.95, matchedBy: "synonym", matchedTerm: "잔고" },
        ],
      },
      menus,
      config: DEFAULT_CONFIG,
    });
  }

  it("medium은 확신이 높아도 사용자가 눌러야 열린다", () => {
    expect(actionFor("medium").kind).toBe("choose");
  });

  it("low는 지금까지처럼 바로 열린다 — 회귀 없음", () => {
    // 환율·영업점 안내처럼 남에게 보여도 그만인 화면까지 막으면 그것은 접근성 손해다.
    expect(actionFor("low").kind).toBe("open");
  });

  it("high는 그대로 막힌다", () => {
    expect(actionFor("high").kind).toBe("choose");
  });
});
