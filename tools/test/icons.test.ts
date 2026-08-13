import { describe, expect, it } from "vitest";
import { guessIcon } from "../src/icons.js";

/**
 * 자동 수집 카탈로그의 아이콘이 전부 같으면 카드가 목록과 다를 바 없다.
 * 여기 나오는 라벨은 전부 실제 수집물에 있는 것이다.
 */

describe("라벨로 고른다", () => {
  it.each([
    ["계좌이체", "transfer"],
    ["자동이체 조회/변경/취소", "repeat"],
    ["계좌조회", "wallet"],
    ["거래내역조회", "list"],
    ["공과금등록/납부", "doc"],
    ["환율/외화예금 금리", "globe"],
    ["예금조회/추가입금", "savings"],
    ["대출계좌조회", "bank"],
    ["내펀드수익률조회", "chart"],
    ["IRP(개인형퇴직연금)", "coin"],
    ["인증서 신규/재발급", "lock"],
    ["이체한도 조회/감액", "transfer"],
  ])("%s → %s", (label, icon) => {
    expect(guessIcon(label)).toBe(icon);
  });
});

describe("먼저 걸리는 것이 이긴다", () => {
  it("자동이체는 이체보다 먼저 본다", () => {
    expect(guessIcon("자동이체 등록")).toBe("repeat");
  });
});

describe("라벨로 못 정하면 경로를 본다", () => {
  it("자주쓰는계좌관리 (뱅킹 > 이체)", () => {
    expect(guessIcon("자주쓰는계좌관리", ["뱅킹", "이체"])).toBe("transfer");
  });

  it("아무 신호도 없으면 기본값", () => {
    expect(guessIcon("사과나무서비스")).toBe("doc");
  });
});
