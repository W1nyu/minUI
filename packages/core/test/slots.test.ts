import { describe, expect, it } from "vitest";
import { parseAmount, pickFromList } from "../src/search/slots.js";

/**
 * 발화에서 값을 뽑는다 (M9).
 *
 * <p>여기 있는 것은 **한국어 처리이지 금융 도메인이 아니다.** `normalize`(조사·어미)와
 * `hangul`(자모)이 core에 있는 것과 같은 이유로 여기 있다 — 무엇이 수취인이고 무엇이
 * 금액인지는 호스트가 정하고, 엔진은 "이 목록 중 하나"와 "얼마"를 한국어에서 읽어낼 뿐이다.
 *
 * <p>어순을 보지 않는 것이 요점이다. 사람은 "엄마한테 3만원"이라고도 하고
 * "3만원 엄마한테"라고도 한다. 자리로 파싱하면 둘 중 하나는 반드시 놓친다.
 */

describe("금액 읽기", () => {
  it("아라비아 숫자와 단위", () => {
    expect(parseAmount("3만원 보내줘")).toBe(30_000);
    expect(parseAmount("30,000원")).toBe(30_000);
    expect(parseAmount("50000원만 보내")).toBe(50_000);
  });

  it("한글 수사", () => {
    expect(parseAmount("삼만원")).toBe(30_000);
    expect(parseAmount("삼십만원 보내줘")).toBe(300_000);
    expect(parseAmount("오천원")).toBe(5_000);
    expect(parseAmount("백만원")).toBe(1_000_000);
    expect(parseAmount("일억")).toBe(100_000_000);
  });

  it("섞여 있어도 읽는다", () => {
    expect(parseAmount("3만 5천원")).toBe(35_000);
    expect(parseAmount("이십오만원")).toBe(250_000);
  });

  it("어순과 상관없다", () => {
    expect(parseAmount("엄마한테 3만원 보내줘")).toBe(30_000);
    expect(parseAmount("3만원 엄마한테 보내줘")).toBe(30_000);
  });

  /*
   * **단위가 없으면 읽지 않는다.** 이 판단이 이 함수에서 가장 중요하다 —
   * 돈을 다루는 자리에서 "아마 금액일 것"은 근거가 아니다. `원`이 붙거나
   * `만`·`억`이 있을 때만 금액으로 본다.
   */
  describe("금액이 아닌 것을 금액으로 읽지 않는다", () => {
    it("숫자만 있으면 아니다", () => {
      expect(parseAmount("3번 계좌")).toBeNull();
      expect(parseAmount("30")).toBeNull();
    });

    it("다른 단위가 붙은 수는 아니다", () => {
      expect(parseAmount("30일에 나가는 거")).toBeNull();
      expect(parseAmount("3개월 적금")).toBeNull();
      expect(parseAmount("2번째 계좌")).toBeNull();
    });

    it("수가 아예 없으면 아니다", () => {
      expect(parseAmount("엄마한테 보내줘")).toBeNull();
      expect(parseAmount("")).toBeNull();
    });

    it("0원은 금액이 아니다", () => {
      expect(parseAmount("0원")).toBeNull();
    });
  });
});

describe("목록에서 고르기", () => {
  const PAYEES = ["엄마", "김철수", "행복아파트 관리사무소", "우리적금"];

  it("이름이 들어 있으면 고른다", () => {
    expect(pickFromList("엄마한테 보내줘", PAYEES)).toBe("엄마");
    expect(pickFromList("김철수 계좌로 3만원", PAYEES)).toBe("김철수");
  });

  it("조사가 붙어도 고른다", () => {
    expect(pickFromList("엄마에게 송금", PAYEES)).toBe("엄마");
    expect(pickFromList("우리적금으로 넣어줘", PAYEES)).toBe("우리적금");
  });

  it("어순과 상관없다", () => {
    expect(pickFromList("3만원 엄마한테", PAYEES)).toBe("엄마");
  });

  /*
   * STT는 고령 발화에서 오인식률이 오른다 (§9.2). 검색이 자모 보정으로 흡수하는 것과
   * 같은 문제라 **같은 함수**를 쓴다 — 두 곳이 다른 방식으로 복구하면 한쪽만 고쳐진다.
   */
  it("한두 음절이 어긋난 인식을 복구한다", () => {
    expect(pickFromList("업마한테 보내줘", PAYEES)).toBe("엄마");
    expect(pickFromList("김철시 계좌", PAYEES)).toBe("김철수");
  });

  it("긴 이름은 일부만 말해도 고른다", () => {
    expect(pickFromList("관리사무소에 보내야 해", PAYEES)).toBe("행복아파트 관리사무소");
  });

  /*
   * **누구에게 보내는지를 잘못 고르는 것은 이 기능이 할 수 있는 가장 나쁜 실수다.**
   * 애매하면 고르지 않는다 — 비어 있는 칸은 사용자가 채우면 되지만, 잘못 채워진 칸은
   * 사용자가 알아채야만 고쳐진다.
   */
  describe("애매하면 고르지 않는다", () => {
    it("목록에 없는 이름은 고르지 않는다", () => {
      expect(pickFromList("박영희한테 보내줘", PAYEES)).toBeNull();
    });

    it("아무 이름도 없으면 고르지 않는다", () => {
      expect(pickFromList("돈 보내줘", PAYEES)).toBeNull();
      expect(pickFromList("", PAYEES)).toBeNull();
    });

    it("목록이 비어 있으면 고르지 않는다", () => {
      expect(pickFromList("엄마한테", [])).toBeNull();
    });

    /*
     * 오인식된 발화가 두 이름에 비슷하게 걸리는 경우다. "김철시"는 `김철수`일 수도
     * `김철순`일 수도 있고, 자모 유사도로는 둘을 가를 수 없다. 이럴 때 찍으면
     * **둘 중 하나에게 남의 돈이 갈 화면이 열린다.**
     */
    it("오인식이 두 이름에 비슷하게 걸리면 고르지 않는다", () => {
      expect(pickFromList("김철시한테", ["김철수", "김철순"])).toBeNull();
    });

    it("한 글자 이름은 문장 어디에나 걸리므로 고르지 않는다", () => {
      expect(pickFromList("돈 보내줘", ["돈"])).toBeNull();
    });
  });

  /*
   * 정확히 말한 이름은 **비슷한 이름이 옆에 있어도** 그것이다. 자모 유사도로만 재면
   * `김철수`와 `김철순`의 차이가 0.04밖에 안 되어 둘 다 버리게 되는데, 그러면 사용자가
   * 이름을 또박또박 말했는데도 아무것도 채워지지 않는다.
   */
  it("정확히 말한 이름은 비슷한 이름이 있어도 고른다", () => {
    expect(pickFromList("김철순한테", ["김철수", "김철순"])).toBe("김철순");
    expect(pickFromList("김철수한테", ["김철수", "김철순"])).toBe("김철수");
  });

  it("똑같은 이름이 둘이면 고르지 않는다", () => {
    expect(pickFromList("엄마한테", ["엄마", "엄마"])).toBeNull();
  });
});
