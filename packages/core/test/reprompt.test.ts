import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { MenuIndex } from "../src/search/MenuIndex.js";
import { buildReprompt } from "../src/search/reprompt.js";
import type { SearchCandidate } from "../src/search/stages.js";
import type { MenuCatalog } from "../src/types.js";

/**
 * 되묻기 선택지를 **후보에서 만든다** (M11).
 *
 * <h3>무엇이 문제였나</h3>
 * 지금 되묻기는 <b>질의를 아예 보지 않는다.</b> `categories().slice(0, 3)`을 그대로 낸다.
 * 신한은행에서 "돈 나가는 거 막아줘"라고 말한 사람이 "개인, 기업, 카드 중 어느 것인가요?"를
 * 듣는다. 기획안 §9.2가 "아직 못 정했다"고 열어 둔 구멍이고, <b>고령 사용자가 실제로
 * 막히는 자리</b>다.
 *
 * <h3>왜 생성이 아니라 선택인가</h3>
 * 자유 문장을 만들면 (a) 잴 방법이 없고 (b) <b>없는 메뉴 이름을 지어낼 수 있다</b> —
 * §8.3이 `assist`를 안전하다고 말하는 근거가 정확히 "자유 생성이 아니라 선택"이다.
 * 길을 잃은 사람에게 보여 주는 화면에서 그 근거를 버릴 이유가 없다.
 *
 * <p>§9.2의 진짜 구멍은 <b>무슨 말을 할까</b>가 아니라 <b>어느 셋을 화면에 놓을까</b>다.
 */

const CATALOG: MenuCatalog = [
  m("t.now", "즉시이체", "이체", ["개인뱅킹", "이체"]),
  m("t.auto", "자동이체", "이체", ["개인뱅킹", "이체"]),
  m("t.bulk", "대량이체", "이체", ["개인뱅킹", "이체"]),
  m("i.balance", "잔액조회", "조회", ["개인뱅킹", "조회"]),
  m("i.history", "거래내역", "조회", ["개인뱅킹", "조회"]),
  m("c.pay", "카드결제", "카드", ["카드", "결제"]),
];

function m(id: string, label: string, category: string, path: string[]) {
  return { id, label, category, icon: "x", route: `/${id}`, riskLevel: "low" as const, path };
}

const INDEX = new MenuIndex(CATALOG);
const SETTINGS = DEFAULT_CONFIG.search.reprompt;

function pool(...entries: [string, number][]): SearchCandidate[] {
  return entries.map(([menuId, score]) => ({
    menuId,
    score,
    matchedBy: "neural" as const,
    matchedTerm: "돈",
  }));
}

describe("buildReprompt", () => {
  it("후보 무게를 가장 고르게 가르는 깊이를 고른다", () => {
    /*
     * 한 묶음이 거의 전부를 가져가는 나눔은 아무것도 가르지 못한다. 깊이 1로 묶으면
     * `개인뱅킹`이 다 가져가므로, 깊이 2(`이체` / `조회`)가 답이다.
     */
    const result = buildReprompt(
      pool(["t.now", 0.3], ["t.auto", 0.3], ["i.balance", 0.3], ["i.history", 0.3]),
      INDEX,
      SETTINGS,
    );

    expect(result.choices.map((c) => c.label).sort()).toEqual(["이체", "조회"]);
  });

  it("선택지 글자는 카탈로그에 있는 것뿐이다 — 지어내지 않는다", () => {
    const segments = new Set(CATALOG.flatMap((menu) => menu.path ?? []));
    const result = buildReprompt(pool(["t.now", 0.4], ["i.balance", 0.4]), INDEX, SETTINGS);

    for (const choice of result.choices) expect(segments.has(choice.label)).toBe(true);
  });

  it("선택지가 자기 묶음의 메뉴를 들고 있다 — 화면이 다시 검색하지 않는다", () => {
    /*
     * 카테고리 이름은 검색어가 아니다(`MenuIndex`가 일부러 term에서 뺀다).
     * 선택지를 누르고 그 말로 다시 검색하면 같은 되묻기로 돌아온다.
     */
    const result = buildReprompt(pool(["t.now", 0.4], ["t.auto", 0.3], ["i.balance", 0.3]), INDEX, SETTINGS);

    for (const choice of result.choices) expect(choice.menuIds.length).toBeGreaterThan(0);
  });

  it("가를 것이 없으면 지금까지처럼 카테고리 앞 세 개를 낸다", () => {
    // 오프라인 바닥이 그대로 남아야 한다. 이 변경은 더하기이지 바꾸기가 아니다.
    const result = buildReprompt([], INDEX, SETTINGS);

    expect(result.choices.map((c) => c.label)).toEqual(INDEX.categories().slice(0, 3));
  });

  it("한 묶음이 다 가져가면 가르지 못한 것으로 본다", () => {
    // 후보가 전부 `이체` 아래면 "이체 중에 있나요?"는 길잡이가 되지 못한다.
    const result = buildReprompt(pool(["t.now", 0.4], ["t.auto", 0.3], ["t.bulk", 0.3]), INDEX, SETTINGS);

    expect(result.choices.map((c) => c.label)).toEqual(INDEX.categories().slice(0, 3));
  });

  it("선택지 수를 넘기지 않는다", () => {
    const result = buildReprompt(
      pool(["t.now", 0.3], ["i.balance", 0.3], ["c.pay", 0.3]),
      INDEX,
      { ...SETTINGS, choiceCount: 2 },
    );

    expect(result.choices.length).toBeLessThanOrEqual(2);
  });

  it("문구는 선택지를 그대로 읽어 준다", () => {
    const result = buildReprompt(pool(["t.now", 0.4], ["i.balance", 0.4]), INDEX, SETTINGS);

    expect(result.prompt).toContain("중에 찾으시는 게 있나요?");
    for (const choice of result.choices) expect(result.prompt).toContain(choice.label);
  });

  it("같은 후보는 늘 같은 선택지를 낸다", () => {
    const run = () => buildReprompt(pool(["t.now", 0.4], ["i.balance", 0.3]), INDEX, SETTINGS);

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
