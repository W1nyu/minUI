import { describe, expect, it } from "vitest";
import { buildUserPrompt, combineRisk, parseResponse, type MenuFacts } from "../src/prompt.js";

/**
 * 모델을 믿지 않는다는 것을 테스트로 굳힌다.
 *
 * <p>LLM 결과는 그대로 카탈로그에 들어간다. 여기서 막지 못하는 것은 사용자 화면까지 간다.
 */

const BATCH: MenuFacts[] = [
  { id: "x.balance", label: "계좌조회", path: ["개인", "조회"] },
  { id: "x.transfer", label: "계좌이체", path: ["개인", "이체"] },
];

describe("프롬프트", () => {
  it("id가 아니라 번호를 준다 — 모델이 없는 id를 지어낼 여지를 없앤다", () => {
    const prompt = buildUserPrompt(BATCH);
    expect(prompt).toContain("0. 계좌조회 (개인 > 조회)");
    expect(prompt).toContain("1. 계좌이체 (개인 > 이체)");
    expect(prompt).not.toContain("x.balance");
  });
});

describe("응답 검증", () => {
  const ok = (over: Record<string, unknown> = {}) => ({
    i: 0,
    speech: ["잔액 보기", "돈 얼마 있어"],
    risk: "low",
    cardable: true,
    hint: "통장에 남은 돈을 봅니다",
    ...over,
  });

  it("정상 응답을 받아들인다", () => {
    const { accepted, rejected } = parseResponse([ok()], BATCH);
    expect(rejected).toEqual([]);
    expect(accepted.get(0)?.synonyms).toEqual(["잔액 보기", "돈 얼마 있어"]);
    expect(accepted.get(0)?.hint).toBe("통장에 남은 돈을 봅니다");
  });

  it("없는 번호를 지어내면 버린다", () => {
    const { accepted, rejected } = parseResponse([ok({ i: 99 })], BATCH);
    expect(accepted.size).toBe(0);
    expect(rejected[0]?.reason).toContain("지어냈다");
  });

  it("메뉴 이름을 그대로 돌려준 동의어는 뺀다 — 검색에 아무것도 더하지 않는다", () => {
    const { accepted } = parseResponse([ok({ speech: ["계좌조회", "계좌 조회", "잔액"] })], BATCH);
    expect(accepted.get(0)?.synonyms).toEqual(["잔액"]);
  });

  it("개인정보 형태는 뺀다", () => {
    const { accepted } = parseResponse(
      [ok({ speech: ["123-456-78901 확인", "01012345678", "잔액 보기"] })],
      BATCH,
    );
    expect(accepted.get(0)?.synonyms).toEqual(["잔액 보기"]);
  });

  it("너무 길거나 짧은 것은 뺀다", () => {
    const { accepted } = parseResponse(
      [ok({ speech: ["가", "이건 스무 글자를 훌쩍 넘기는 아주 긴 문장입니다 정말로", "잔액"] })],
      BATCH,
    );
    expect(accepted.get(0)?.synonyms).toEqual(["잔액"]);
  });

  it("같은 말을 여러 번 주면 하나만 남긴다", () => {
    const { accepted } = parseResponse([ok({ speech: ["잔액 보기", "잔액보기", "잔액 보기"] })], BATCH);
    expect(accepted.get(0)?.synonyms).toEqual(["잔액 보기"]);
  });

  it("번호가 겹치면 뒤엣것을 버린다", () => {
    const { accepted, rejected } = parseResponse([ok(), ok({ speech: ["다른 말"] })], BATCH);
    expect(accepted.size).toBe(1);
    expect(rejected[0]?.reason).toContain("중복");
  });

  it("배열이 아니면 통째로 버린다", () => {
    const { accepted, rejected } = parseResponse({ speech: [] }, BATCH);
    expect(accepted.size).toBe(0);
    expect(rejected).toHaveLength(1);
  });

  it("쓸 것이 하나도 없으면 버린다", () => {
    const { accepted } = parseResponse([ok({ speech: [], hint: "" })], BATCH);
    expect(accepted.size).toBe(0);
  });

  /*
   * 뜻풀이가 이름을 되풀이하면 아무것도 풀어 주지 않는다 — 모르는 말을 같은 말로
   * 되돌려 주는 셈이다. 동의어에는 이미 같은 규칙이 있는데 뜻풀이에는 없었다.
   */
  it("메뉴 이름을 되풀이한 hint는 버린다", () => {
    const { accepted } = parseResponse([ok({ hint: "계좌 조회입니다" })], BATCH);
    expect(accepted.get(0)?.hint).toBe("");
  });

  it("이름을 품고 있어도 설명이 더 있으면 살린다 — 과하게 버리지 않는다", () => {
    const { accepted } = parseResponse(
      [ok({ hint: "계좌조회는 통장에 남은 돈을 보는 것" })],
      BATCH,
    );
    expect(accepted.get(0)?.hint).toBe("계좌조회는 통장에 남은 돈을 보는 것");
  });

  it("hint가 너무 길면 버리되 동의어는 살린다", () => {
    const { accepted } = parseResponse(
      [ok({ hint: "이 메뉴는 계좌의 잔액을 조회하는 기능으로서 매우 유용하며 자주 쓰입니다" })],
      BATCH,
    );
    expect(accepted.get(0)?.hint).toBe("");
    expect(accepted.get(0)?.synonyms.length).toBeGreaterThan(0);
  });
});

describe("위험도 — 모델이 낮추지 못한다 (기획안 §9.3)", () => {
  it("정규식이 high면 모델이 low라 해도 high다", () => {
    expect(combineRisk("high", "low")).toBe("high");
  });

  it("모델이 high면 정규식이 low라도 high다 — 더 위험한 쪽을 택한다", () => {
    expect(combineRisk("low", "high")).toBe("high");
  });

  it("둘 다 low면 low다", () => {
    expect(combineRisk("low", "low")).toBe("low");
  });
});

describe("실측에서 드러난 것들", () => {
  const ok = (over: Record<string, unknown> = {}) => ({
    i: 0,
    speech: ["잔고"],
    risk: "low",
    cardable: true,
    hint: "",
    ...over,
  });

  /*
   * 사람이 쓴 동의어는 평균 4.4자, LLM은 6.7자였고 정확도가 80% 대 27%로 갈렸다.
   * 파이프라인의 포함 판정이 짧은 말에 유리하다 — "돈 얼마 있어"는 질의 "잔액"을
   * 포함하지도, 거기 포함되지도 않는다.
   */
  it("긴 문장은 버린다", () => {
    const { accepted } = parseResponse(
      [ok({ speech: ["잔고", "통장에 돈이 얼마나 있는지 보기", "돈 얼마"] })],
      BATCH,
    );
    expect(accepted.get(0)?.synonyms).toEqual(["잔고", "돈 얼마"]);
  });

  /*
   * KB국민은행 메뉴에 "우리은행 돈 보기"가 붙었다. 다른 회사 이름은 틀린 정보다.
   * 그런데 통째로 버렸더니 "국민은행 잔액"까지 날아가고 "은행 잔고" 같은 껍데기만 남아
   * 고치려던 것보다 나빠졌다. 그래서 **떼어 낸다.**
   */
  it("회사 이름은 떼어 내고 남는 말을 쓴다", () => {
    const { accepted } = parseResponse(
      [ok({ speech: ["우리은행 돈 보기", "국민은행 잔액", "은행 잔고"] })],
      BATCH,
    );
    expect(accepted.get(0)?.synonyms).toEqual(["돈 보기", "잔액", "잔고"]);
  });

  it("여덟 개까지 받는다", () => {
    const many = ["잔고", "잔액", "돈 얼마", "통장 확인", "남은 돈", "예금액", "보유액", "총액", "아홉째"];
    const { accepted } = parseResponse([ok({ speech: many })], BATCH);
    expect(accepted.get(0)?.synonyms).toHaveLength(8);
  });
});
