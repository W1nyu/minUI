import { describe, expect, it } from "vitest";
import { pronounce } from "../src/search/phonology.js";

/*
 * 발음 표기는 STT가 "소리나는 대로" 적은 것과 메뉴 라벨을 같은 공간에서 만나게 한다.
 * 라벨에 없는 어휘를 만들어 내지 않는다 — 소리는 이미 라벨 안에 있다.
 */

describe("발음 표기 — 연음", () => {
  it("받침이 뒤 음절 초성 ㅇ 자리로 넘어간다", () => {
    expect(pronounce("잔액")).toBe("자낵");
    expect(pronounce("직업")).toBe("지겁");
    expect(pronounce("신용")).toBe("시뇽");
  });

  it("받침 ㅇ은 넘어가지 않는다", () => {
    expect(pronounce("강아지")).toBe("강아지");
  });

  it("받침 ㅎ은 넘어가지 않고 사라진다", () => {
    expect(pronounce("좋아")).toBe("조아");
    expect(pronounce("싫어")).toBe("시러");
  });

  it("겹받침은 앞것을 남기고 뒷것만 넘긴다", () => {
    expect(pronounce("앉아")).toBe("안자");
    expect(pronounce("읽어")).toBe("일거");
    expect(pronounce("젊어")).toBe("절머");
  });

  it("겹받침의 ㅅ은 넘어가면서 된소리가 된다", () => {
    expect(pronounce("값이")).toBe("갑씨");
    expect(pronounce("넋이")).toBe("넉씨");
  });

  it("겹받침 ㄶ·ㅀ은 ㅎ이 빠지고 앞것이 넘어간다", () => {
    expect(pronounce("많아")).toBe("마나");
  });
});

describe("발음 표기 — 겹받침 단순화", () => {
  it("뒤에 ㅇ이 없으면 한 자음만 남는다", () => {
    expect(pronounce("닭")).toBe("닥");
    expect(pronounce("여덟")).toBe("여덜");
    expect(pronounce("값")).toBe("갑");
    expect(pronounce("삶")).toBe("삼");
  });
});

describe("발음 표기 — 종성 중화 (7종성)", () => {
  it("받침은 ㄱㄴㄷㄹㅁㅂㅇ 일곱 개로 줄어든다", () => {
    expect(pronounce("꽃")).toBe("꼳");
    expect(pronounce("부엌")).toBe("부억");
    expect(pronounce("옷")).toBe("옫");
    expect(pronounce("앞")).toBe("압");
  });
});

describe("발음 표기 — ㅎ 축약", () => {
  it("받침 ㅎ이 뒤 예사소리를 거센소리로 만든다", () => {
    expect(pronounce("놓고")).toBe("노코");
    expect(pronounce("좋다")).toBe("조타");
  });

  it("앞 받침이 뒤 ㅎ을 만나도 거센소리가 된다", () => {
    expect(pronounce("입학")).toBe("이팍");
    expect(pronounce("축하")).toBe("추카");
  });
});

describe("발음 표기 — 구개음화", () => {
  it("받침 ㄷ·ㅌ이 뒤의 이를 만나면 ㅈ·ㅊ이 된다", () => {
    expect(pronounce("굳이")).toBe("구지");
    expect(pronounce("같이")).toBe("가치");
  });
});

describe("발음 표기 — 경음화", () => {
  it("받침 ㄱㄷㅂ 뒤의 예사소리가 된소리가 된다", () => {
    expect(pronounce("적금")).toBe("적끔");
    expect(pronounce("입금")).toBe("입끔");
    expect(pronounce("학교")).toBe("학꾜");
  });

  it("중화된 받침에도 걸린다", () => {
    // 옷장 → (중화) 옫장 → (경음화) 옫짱
    expect(pronounce("옷장")).toBe("옫짱");
  });

  it("받침 ㄹ 뒤의 ㄷㅅㅈ이 된소리가 된다 — 금융 메뉴는 한자어가 대부분이다", () => {
    expect(pronounce("결제")).toBe("결쩨");
    expect(pronounce("발전")).toBe("발쩐");
  });

  it("받침 ㄹ 뒤의 ㄱ은 그대로다", () => {
    expect(pronounce("출금")).toBe("출금");
  });
});

describe("발음 표기 — 비음화", () => {
  it("받침 ㄱㄷㅂ이 ㄴㅁ 앞에서 콧소리가 된다", () => {
    expect(pronounce("국민")).toBe("궁민");
    expect(pronounce("학년")).toBe("항년");
    expect(pronounce("입니")).toBe("임니");
  });

  it("ㅁㅇ 받침 뒤의 ㄹ은 ㄴ이 된다", () => {
    expect(pronounce("종로")).toBe("종노");
    expect(pronounce("담력")).toBe("담녁");
  });

  it("ㄱㅂ 받침 뒤의 ㄹ은 ㄴ이 되고 받침도 따라 바뀐다", () => {
    expect(pronounce("백로")).toBe("뱅노");
    expect(pronounce("협력")).toBe("혐녁");
  });
});

describe("발음 표기 — 유음화", () => {
  it("ㄴ과 ㄹ이 만나면 ㄹㄹ이 된다", () => {
    expect(pronounce("신라")).toBe("실라");
    expect(pronounce("칼날")).toBe("칼랄");
  });
});

describe("발음 표기 — 경계와 통과", () => {
  it("빈 문자열은 빈 문자열이다", () => {
    expect(pronounce("")).toBe("");
  });

  it("한글이 아닌 문자는 그대로 통과하고 앞뒤 음운 규칙을 끊는다", () => {
    expect(pronounce("abc")).toBe("abc");
    // 사이에 다른 문자가 끼면 연음이 일어나지 않는다.
    expect(pronounce("잔1액")).toBe("잔1액");
  });

  it("이미 소리대로 적힌 말은 그대로다 — 멱등에 가깝다", () => {
    expect(pronounce("자낵")).toBe("자낵");
    expect(pronounce("이체")).toBe("이체");
  });

  it("바뀔 것이 없는 메뉴 이름은 건드리지 않는다", () => {
    for (const word of ["이체", "송금", "대출", "조회", "한도", "예금", "보험"]) {
      expect(pronounce(word)).toBe(word);
    }
  });
});

describe("발음 표기 — 이 기능이 노리는 것", () => {
  it("STT가 소리대로 적은 말과 메뉴 이름이 같은 표기로 만난다", () => {
    // 글자로는 다르지만 소리로는 같다.
    expect(pronounce("자낵조회")).toBe(pronounce("잔액조회"));
    expect(pronounce("적끔")).toBe(pronounce("적금"));
    expect(pronounce("궁민")).toBe(pronounce("국민"));
  });
});
