import { describe, expect, it } from "vitest";
import { normalize } from "../src/search/normalize.js";

describe("정규화 ① (기획안 §8.3)", () => {
  it("공백을 없앤다", () => {
    expect(normalize("돈 보내기")).toBe("돈보내기");
  });

  it("자모 결합형을 NFC로 통일한다", () => {
    // 같은 "가"라도 NFD(ᄀ+ᅡ)로 들어올 수 있다. STT·IME마다 다르다.
    const nfd = "가";
    expect(normalize(nfd)).toBe(normalize("가"));
  });

  it("문장부호를 없앤다", () => {
    expect(normalize("이체, 해줘!")).toBe(normalize("이체해줘"));
  });

  it("영문은 소문자로 맞춘다", () => {
    expect(normalize("ATM")).toBe("atm");
  });
});

describe("조사·어미 제거", () => {
  it("목적격 조사를 뗀다", () => {
    expect(normalize("이체를")).toBe("이체");
    expect(normalize("돈을")).toBe("돈");
  });

  it("주격·보조사를 뗀다", () => {
    expect(normalize("잔액이")).toBe("잔액");
    expect(normalize("대출은")).toBe("대출");
  });

  it("서술 어미를 뗀다", () => {
    expect(normalize("보내야해")).toBe("보내");
    expect(normalize("확인하고싶어")).toBe("확인");
    expect(normalize("바꿔줘")).toBe("바꿔");
  });

  it("'하는데'로 끝나는 말도 처리한다", () => {
    expect(normalize("이체해야하는데")).toBe("이체");
  });

  it("두 글자 이하로 줄어들 만큼은 깎지 않는다", () => {
    // "이체"의 "체"를 조사로 오인해 "이"만 남기면 검색이 무너진다.
    expect(normalize("이체")).toBe("이체");
    expect(normalize("내역")).toBe("내역");
    expect(normalize("한도")).toBe("한도");
  });

  it("조사처럼 보이는 글자로 끝나는 단어를 망가뜨리지 않는다", () => {
    expect(normalize("송금")).toBe("송금");
    expect(normalize("자동이체")).toBe("자동이체");
    expect(normalize("계좌")).toBe("계좌");
  });

  it("여러 어절이 붙어 있어도 어절마다 처리한다", () => {
    expect(normalize("관리비를 이체해야해")).toBe("관리비이체");
  });

  it("빈 입력은 빈 문자열이다", () => {
    expect(normalize("   ")).toBe("");
  });
});

describe("군말 제거", () => {
  it("'좀'처럼 뜻 없는 말을 버린다", () => {
    // 사전의 "돈 부쳐"와 글자가 다 겹치는데 가운데 낀 "좀" 하나가 매칭을 깬다.
    expect(normalize("돈 좀 부쳐야 하는데")).toBe("돈부쳐");
  });

  it("여러 군말이 섞여도 걷어낸다", () => {
    expect(normalize("그냥 다시 이체해줘")).toBe("이체");
  });

  it("군말과 같은 글자로 끝나는 단어는 건드리지 않는다", () => {
    // 어절 전체가 군말일 때만 버린다.
    expect(normalize("저축")).toBe("저축");
    expect(normalize("어음")).toBe("어음");
  });
});
