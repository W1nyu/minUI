import { describe, expect, it } from "vitest";
import { guessRisk } from "../src/risk.js";

/**
 * 위험도 1차 판정. **§9.3의 안전 경계로 이어지므로 양쪽 오류를 모두 잰다.**
 *
 * <p>여기 나오는 라벨은 전부 실제 수집물에 있는 것이다.
 */

describe("자금이 움직이면 high", () => {
  it.each([
    ["계좌이체", []],
    ["즉시이체", []],
    ["자동이체 등록", []],
    ["대출신청", []],
    ["비밀번호 등록/변경", []],
    ["인증서 신규/재발급", []],
    ["공과금등록/납부", []],
    ["환전지갑", []],
  ])("%s", (label, path) => {
    expect(guessRisk(label, path as string[])).toBe("high");
  });

  it("라벨에 안 드러나면 경로를 본다", () => {
    // "간편이체"는 그 자체로도 걸리지만, 이런 경우를 위해 경로를 본다.
    expect(guessRisk("자주쓰는계좌관리", ["뱅킹", "이체"])).toBe("high");
  });
});

describe("읽기만 하면 high가 아니다 — 앞에 무서운 말이 있어도", () => {
  /*
   * 이것이 이 파일의 요점이다. 규칙이 거칠 때 하나은행 40개 중 65%가 high로 나왔고,
   * 그러면 음성이 "언제나 확인 한 번 더"가 되어 주 기능이 무너진다.
   *
   * **M11에서 이 블록이 low와 medium으로 갈렸다.** 읽는 화면이라는 판정은 그대로지만,
   * 내 잔액·내 거래를 띄우는 화면은 자동으로 열리면 안 된다(§9.3 위협 모형).
   * 바뀐 것은 수준이지 판정이 아니다 — 여전히 **아무것도 high가 아니다.**
   */
  it.each([
    "해지계좌 조회",
    "해지계좌조회",
    "자동이체내역조회",
    "이체결과조회",
    "대출거래내역조회",
    "세금우대한도조회",
    "납부내역 조회",
    "인증서안내",
    "해외주식 거래안내",
    "CMA 알아보기 소개",
  ])("%s — high가 아니다", (label) => {
    expect(guessRisk(label)).not.toBe("high");
  });

  it.each([
    "해지계좌 조회",
    "해지계좌조회",
    "자동이체내역조회",
    "이체결과조회",
    "대출거래내역조회",
    "세금우대한도조회",
  ])("%s — 내 데이터라 medium", (label) => {
    expect(guessRisk(label)).toBe("medium");
  });

  it.each([
    "인증서안내",
    "해외주식 거래안내",
    "CMA 알아보기 소개",
    "납부내역 조회",
  ])("%s — 설명문이거나 남이 봐도 그만이라 low", (label) => {
    // `안내`·`소개`로 끝나면 설명문이다. 그것까지 막으면 접근성 손해만 남는다.
    expect(guessRisk(label)).toBe("low");
  });

  it("경로에 이체가 있어도 라벨이 내역이면 읽는 화면이다", () => {
    // 여전히 high가 아니다. 그것이 이 테스트가 지키려던 것이고, 지금도 지켜진다.
    expect(guessRisk("계좌이체내역조회", ["개인", "이체"])).toBe("medium");
  });
});

describe("행위가 끝에 오면 high로 남는다", () => {
  it.each([
    "자동이체 조회/변경/취소",
    "예금해지",
    "펀드환매",
    "대출금상환",
    "이체한도 조회/감액",
  ])("%s", (label) => {
    expect(guessRisk(label)).toBe("high");
  });
});

describe("아무 신호도 없으면 low", () => {
  it.each(["환율", "펀드몰", "고객센터", "영업점"])("%s", (label) => {
    expect(guessRisk(label)).toBe("low");
  });
});

/**
 * 민감한 조회는 `medium`이다 (M11 Task 20′).
 *
 * <p>지금 규칙은 <b>돈이 움직이는가</b>만 본다. 그래서 잔액·거래내역처럼 읽기만 하는
 * 화면이 `low`가 되고, 확신이 높으면 확인 없이 열린다 — 잠금 해제된 기기를 잠깐 쥔
 * 사람이 "잔액 얼마야"로 볼 수 있다. <b>돈은 안 나가지만 정보는 나간다.</b>
 *
 * <p>읽는 화면이라는 판정은 그대로 두고 <b>무엇을 보여 주는가</b>를 한 겹 더 본다.
 */
describe("민감한 조회 — medium", () => {
  it("잔액을 보여 주는 조회는 medium", () => {
    expect(guessRisk("계좌조회")).toBe("medium");
    expect(guessRisk("잔액조회")).toBe("medium");
    expect(guessRisk("출금가능금액조회")).toBe("medium");
  });

  it("거래내역을 보여 주는 조회는 medium", () => {
    expect(guessRisk("거래내역조회")).toBe("medium");
    expect(guessRisk("입출금내역")).toBe("medium");
  });

  it("남에게 보여도 그만인 조회는 low 그대로", () => {
    // 여기까지 막으면 접근성 손해다. 음성이 "언제나 확인 한 번 더"가 되면 주 기능이 무너진다.
    expect(guessRisk("환율조회")).toBe("low");
    expect(guessRisk("영업점 안내")).toBe("low");
    expect(guessRisk("금융상품 소개")).toBe("low");
  });

  it("돈이 움직이는 것은 high 그대로 — medium이 high를 잡아먹지 않는다", () => {
    expect(guessRisk("계좌이체")).toBe("high");
    expect(guessRisk("잔액 이체하기")).toBe("high");
  });

  it("갈래에 민감한 말이 있어도 라벨이 기준이다", () => {
    // 기존 규칙과 같은 판단이다 — `해지계좌 조회`가 해지가 아니라 조회인 것과 같다.
    expect(guessRisk("환율조회", ["잔액"])).toBe("low");
  });
});
