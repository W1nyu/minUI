import { describe, expect, it } from "vitest";
import {
  UNIFORM_COSTS,
  alignJamo,
  countConfusions,
  weightedJamoSimilarity,
  type ConfusionCosts,
} from "../src/search/confusion.js";
import { jamoSimilarity } from "../src/search/hangul.js";

describe("자모 정렬 — 학습 재료를 만든다", () => {
  it("같은 말은 전부 일치다", () => {
    const ops = alignJamo("이체", "이체");
    expect(ops.every((op) => op.kind === "match")).toBe(true);
  });

  it("한 음이 다르면 치환 하나로 정렬된다", () => {
    // 이체 → 이제: ᄎ 자리에 ᄌ 이 들어왔다.
    const subs = alignJamo("이체", "이제").filter((op) => op.kind === "sub");
    expect(subs).toEqual([{ kind: "sub", intended: "ᄎ", heard: "ᄌ" }]);
  });

  it("받침이 사라진 것은 삭제다", () => {
    const ops = alignJamo("송금", "소금");
    expect(ops.filter((op) => op.kind === "del")).toEqual([{ kind: "del", intended: "ᆼ" }]);
  });

  it("없던 소리가 붙은 것은 삽입이다", () => {
    const ops = alignJamo("소금", "송금");
    expect(ops.filter((op) => op.kind === "ins")).toEqual([{ kind: "ins", heard: "ᆼ" }]);
  });

  it("빈 문자열끼리는 아무 연산도 없다", () => {
    expect(alignJamo("", "")).toEqual([]);
  });
});

describe("혼동 집계 — 코퍼스에서 표를 만든다", () => {
  it("치환을 방향까지 세어 둔다", () => {
    const tally = countConfusions([
      { intended: "이체", heard: "이제" },
      { intended: "이체", heard: "이제" },
      { intended: "이체", heard: "이체" },
    ]);
    expect(tally.subs.get("ᄎ>ᄌ")).toBe(2);
    // 맞게 들린 것도 세어야 확률의 분모가 생긴다.
    expect(tally.observed.get("ᄎ")).toBe(3);
  });

  it("빈 코퍼스는 빈 집계다", () => {
    const tally = countConfusions([]);
    expect(tally.subs.size).toBe(0);
    expect(tally.observed.size).toBe(0);
  });
});

describe("가중 자모 유사도", () => {
  const pairs: readonly (readonly [string, string])[] = [
    ["이체", "이제"],
    ["자동이체안나가게해야하는데", "자동이체"],
    ["송금", "송그"],
    ["이체", "대출"],
    ["", ""],
    ["이체", ""],
    ["", "이체"],
    ["잔액조회", "자낵쪼회"],
  ];

  it("비용표가 비면 기존 자모 유사도와 값이 같다 — 켜도 아무것도 바뀌지 않는다", () => {
    for (const [haystack, needle] of pairs) {
      expect(weightedJamoSimilarity(haystack, needle, UNIFORM_COSTS)).toBe(
        jamoSimilarity(haystack, needle),
      );
    }
  });

  it("자주 헷갈리는 자리는 덜 깎는다", () => {
    const learned: ConfusionCosts = {
      ...UNIFORM_COSTS,
      subs: { "ᄎ>ᄌ": 0.1 },
    };
    const uniform = weightedJamoSimilarity("이제", "이체", UNIFORM_COSTS);
    const weighted = weightedJamoSimilarity("이제", "이체", learned);
    expect(weighted).toBeGreaterThan(uniform);
  });

  it("배우지 않은 자리는 그대로 깎는다", () => {
    const learned: ConfusionCosts = { ...UNIFORM_COSTS, subs: { "ᄎ>ᄌ": 0.1 } };
    expect(weightedJamoSimilarity("대출", "이체", learned)).toBe(
      weightedJamoSimilarity("대출", "이체", UNIFORM_COSTS),
    );
  });

  it("배운 비용이 있어도 0과 1 사이를 벗어나지 않는다", () => {
    const learned: ConfusionCosts = { ...UNIFORM_COSTS, subs: { "ᄎ>ᄌ": 0.1 } };
    const value = weightedJamoSimilarity("이제", "이체", learned);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("방향이 있다 — 의도한 소리에서 들린 소리로 읽는다", () => {
    const oneWay: ConfusionCosts = { ...UNIFORM_COSTS, subs: { "ᄎ>ᄌ": 0.1 } };
    // needle(메뉴 소리)이 ᄎ, haystack(들린 말)이 ᄌ일 때만 싸다.
    expect(weightedJamoSimilarity("이제", "이체", oneWay)).toBeGreaterThan(
      weightedJamoSimilarity("이체", "이제", oneWay),
    );
  });
});
