import { describe, expect, it } from "vitest";
import { jamoDistance, jamoSimilarity, toJamo } from "../src/search/hangul.js";

describe("자모 분해", () => {
  it("초성·중성·종성으로 나눈다", () => {
    expect(toJamo("각")).toEqual(["ᄀ", "ᅡ", "ᆨ"]);
  });

  it("받침이 없으면 두 개다", () => {
    expect(toJamo("가")).toEqual(["ᄀ", "ᅡ"]);
  });

  it("겹받침도 한 글자로 둔다 — 자모 단위 비교에는 그것으로 충분하다", () => {
    expect(toJamo("값")).toEqual(["ᄀ", "ᅡ", "ᆹ"]);
  });

  it("한글이 아닌 문자는 그대로 통과시킨다", () => {
    expect(toJamo("a1가")).toEqual(["a", "1", "ᄀ", "ᅡ"]);
  });

  it("빈 문자열은 빈 배열이다", () => {
    expect(toJamo("")).toEqual([]);
  });
});

describe("자모 편집거리 — STT 오인식 복구 (기획안 §8.3 ④)", () => {
  it("같은 말은 거리 0이다", () => {
    expect(jamoDistance("이체", "이체")).toBe(0);
  });

  it("모음 하나가 틀린 오인식은 가깝다", () => {
    // "이체"를 "이제"로 받는 전형적인 오인식
    expect(jamoDistance("이체", "이제")).toBe(1);
  });

  it("받침 하나 차이도 가깝다", () => {
    expect(jamoDistance("송금", "송그")).toBe(1);
  });

  it("글자 단위로 보면 완전히 달라 보이는 말도 자모로는 가깝다", () => {
    // 글자 비교로는 2글자 중 1글자가 달라 50% 차이지만,
    // 자모로는 5개 중 1개라 20% 차이다. 이 감도 차이가 복구력을 만든다.
    const 글자기준 = 1 / 2;
    const 자모기준 = jamoDistance("이체", "이제") / toJamo("이체").length;
    expect(자모기준).toBeLessThan(글자기준);
  });

  it("전혀 다른 말은 멀다", () => {
    expect(jamoDistance("이체", "대출")).toBeGreaterThan(2);
  });
});

describe("자모 유사도", () => {
  it("0과 1 사이다", () => {
    expect(jamoSimilarity("이체", "이제")).toBeGreaterThan(0);
    expect(jamoSimilarity("이체", "이제")).toBeLessThan(1);
    expect(jamoSimilarity("이체", "이체")).toBe(1);
  });

  it("오인식된 말이 무관한 말보다 높다", () => {
    expect(jamoSimilarity("이체", "이제")).toBeGreaterThan(
      jamoSimilarity("이체", "대출"),
    );
  });

  it("둘 다 비면 1이다", () => {
    expect(jamoSimilarity("", "")).toBe(1);
  });

  it("한쪽만 비면 0이다", () => {
    expect(jamoSimilarity("이체", "")).toBe(0);
  });

  it("긴 문장 안에 짧은 말이 들어 있어도 길이 차이로 깎이지 않는다", () => {
    // "자동이체 안 나가게 해야 하는데" 안의 "자동이체"를 찾아야 한다.
    // 전체 길이로 정규화하면 짧은 메뉴 이름은 영원히 임계치를 못 넘는다.
    const inside = jamoSimilarity("자동이체안나가게해야하는데", "자동이체");
    expect(inside).toBeGreaterThan(0.8);
  });
});
