import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { applyPrior, toPrior, type MenuPrior } from "../src/search/prior.js";
import type { SearchCandidate } from "../src/search/stages.js";
import type { ScoreBreakdown } from "../src/types.js";

/*
 * 사전확률은 잡음 채널의 나머지 반쪽이다 — `P(의도 | 들린말) ∝ P(들린말 | 의도) × P(의도)`.
 * M21이 가능도를 지었고 여기가 사전확률이다.
 *
 * 이 파일이 지키는 것은 정확도가 아니라 **경계**다. 사전확률은 정답을 밀어내거나
 * 문턱을 넘겨서는 안 된다.
 */

// 기본값은 꺼져 있다(게이트 전). 켠 상태를 재려면 직접 만든다.
const settings = { ...DEFAULT_CONFIG.search.prior, enabled: true };
const THRESHOLD = DEFAULT_CONFIG.search.minConfidence;

function breakdown(menuId: string, total: number): ScoreBreakdown {
  return {
    menuId,
    frequency: total,
    recency: 0,
    context: 0,
    pin: 0,
    total,
    views: Math.round(total),
    lastUsedAt: null,
  };
}

function candidate(
  menuId: string,
  score: number,
  matchedBy: SearchCandidate["matchedBy"] = "synonym",
): SearchCandidate {
  return { menuId, score, matchedBy, matchedTerm: menuId };
}

describe("사전확률 만들기", () => {
  it("가장 많이 쓴 것이 1이고, 안 쓴 것은 표에 아예 없다", () => {
    const prior = toPrior([breakdown("a", 10), breakdown("b", 5), breakdown("c", 0)], settings);
    expect(prior.get("a")).toBe(1);
    // 0이 아니라 없다. 있으면 "0인 사전확률"이 되어 깎는 쪽으로 읽힌다.
    expect(prior.has("c")).toBe(false);
    expect(prior.get("b")).toBeGreaterThan(0);
    expect(prior.get("b")).toBeLessThan(1);
  });

  it("전부 0이면 사전확률이 없다 — 콜드 스타트에서 아무것도 기울이지 않는다", () => {
    const prior = toPrior([breakdown("a", 0), breakdown("b", 0)], settings);
    expect(prior.size).toBe(0);
  });

  it("기록이 없으면 빈 것이다", () => {
    expect(toPrior([], settings).size).toBe(0);
  });

  it("0과 1 사이를 벗어나지 않는다", () => {
    const prior = toPrior([breakdown("a", 100), breakdown("b", 1)], settings);
    for (const value of prior.values()) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("바닥 아래는 버린다 — 한두 번 쓴 것이 사전확률 행세를 하지 않는다", () => {
    const strict = { ...settings, floor: 0.5 };
    const prior = toPrior([breakdown("a", 10), breakdown("b", 1)], strict);
    expect(prior.has("a")).toBe(true);
    expect(prior.has("b")).toBe(false);
  });
});

describe("사전확률 얹기 — 경계 ★", () => {
  const prior: MenuPrior = new Map([
    ["자주", 1],
    ["가끔", 0.5],
  ]);

  it("꺼져 있으면 후보가 그대로다 — 기본값이 그것이다", () => {
    const before = [candidate("자주", 0.5), candidate("낯선", 0.5)];
    const after = applyPrior(before, prior, DEFAULT_CONFIG.search.prior, THRESHOLD);
    expect(after).toEqual(before);
    expect(DEFAULT_CONFIG.search.prior.enabled).toBe(false);
  });

  it("사전확률이 비면 후보가 그대로다 — 켜도 아무것도 바뀌지 않는다", () => {
    const before = [candidate("자주", 0.5)];
    expect(applyPrior(before, new Map(), settings, THRESHOLD)).toEqual(before);
  });

  it("자주 쓰는 메뉴를 올린다", () => {
    const [raised] = applyPrior([candidate("자주", 0.5)], prior, settings, THRESHOLD);
    expect(raised!.score).toBeGreaterThan(0.5);
  });

  it("기록이 없는 메뉴는 깎지 않는다 — 벌이 아니라 상이다", () => {
    const [untouched] = applyPrior([candidate("낯선", 0.5)], prior, settings, THRESHOLD);
    expect(untouched!.score).toBe(0.5);
  });

  it("★ 정확 매칭에는 걸지 않는다 — 자주 쓴다고 정답을 밀어내지 못한다", () => {
    const [exact] = applyPrior([candidate("자주", 1, "exact")], prior, settings, THRESHOLD);
    expect(exact!.score).toBe(1);
    expect(exact!.matchedBy).toBe("exact");
  });

  it("★ 정확 매칭이 있으면 자주 쓰는 다른 메뉴가 그것을 넘지 못한다", () => {
    const after = applyPrior(
      [candidate("정답", 1, "exact"), candidate("자주", 0.95)],
      prior,
      settings,
      THRESHOLD,
    );
    const answer = after.find((c) => c.menuId === "정답")!;
    const frequent = after.find((c) => c.menuId === "자주")!;
    expect(answer.score).toBeGreaterThanOrEqual(frequent.score);
  });

  it("★ 1.0을 넘지 않는다 — 정확 매칭의 자리를 침범하지 않는다", () => {
    const [capped] = applyPrior([candidate("자주", 0.99)], prior, settings, THRESHOLD);
    expect(capped!.score).toBeLessThanOrEqual(1);
  });

  it("단계 이름과 걸린 표현은 바뀌지 않는다", () => {
    const [same] = applyPrior([candidate("자주", 0.5, "phonetic")], prior, settings, THRESHOLD);
    expect(same!.matchedBy).toBe("phonetic");
    expect(same!.matchedTerm).toBe("자주");
  });

  it("★ 올리는 힘이 작다 — 문턱 아래 후보를 혼자 넘기지 못한다", () => {
    // 문턱 아래는 아예 손대지 않는다 — 넘기지 못하는 것을 넘어, 값이 그대로다.
    const below = THRESHOLD - 0.01;
    const [lifted] = applyPrior([candidate("자주", below)], prior, settings, THRESHOLD);
    expect(lifted!.score).toBe(below);
  });

  it("원본 배열을 건드리지 않는다", () => {
    const before = [candidate("자주", 0.5)];
    applyPrior(before, prior, settings, THRESHOLD);
    expect(before[0]!.score).toBe(0.5);
  });
});
