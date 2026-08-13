import { describe, expect, it } from "vitest";
import {
  EXPLAIN_SYSTEM,
  buildExplainPrompt,
  parseExplainResponse,
} from "../src/explain.js";

/**
 * 런타임 뜻풀이 — "이게 무슨 뜻이에요?"
 *
 * <p>빌드 타임 보강(`prompt.ts`)이 채우지 못한 메뉴를 그 자리에서 푼다. 신한 930개 중
 * 745개에만 hint가 있으므로 나머지는 여기로 온다.
 *
 * <p>검증은 빌드 타임과 **같은 규칙**을 쓴다. 두 경로가 다른 것을 통과시키면
 * 사용자가 보는 뜻풀이의 품질이 어디서 왔느냐에 따라 달라진다.
 */

const TARGET = { label: "예수금", path: ["주식", "계좌"] } as const;

describe("프롬프트", () => {
  it("메뉴 이름과 어디에 있는지를 함께 준다", () => {
    const prompt = buildExplainPrompt(TARGET);
    expect(prompt).toContain("예수금");
    expect(prompt).toContain("주식 > 계좌");
  });

  it("계층이 없는 호스트도 받는다", () => {
    expect(buildExplainPrompt({ label: "예수금" })).toContain("예수금");
  });

  /*
   * 뜻풀이는 조회성 정보라 §9.3의 안전 경계 밖이다. 그렇다고 무엇이든 말해도 되는 것은
   * 아니다 — 금융 앱 안에서 모델이 상품을 권하거나 투자 판단을 하면 그것은 투자권유다.
   * 경계를 프롬프트에 박아 두고, 박혀 있다는 것을 테스트로 굳힌다.
   */
  it("상품 추천과 투자 판단을 금지한다", () => {
    expect(EXPLAIN_SYSTEM).toContain("추천");
    expect(EXPLAIN_SYSTEM).toContain("투자 판단");
    expect(EXPLAIN_SYSTEM).toContain("금액");
  });
});

describe("응답 검증 — 빌드 타임과 같은 규칙", () => {
  it("쓸 만한 풀이를 받는다", () => {
    expect(parseExplainResponse({ hint: "바로 뺄 수 있는 돈이에요" }, TARGET)).toBe(
      "바로 뺄 수 있는 돈이에요",
    );
  });

  it("이름을 되풀이한 풀이는 거절한다", () => {
    expect(parseExplainResponse({ hint: "예수금입니다" }, TARGET)).toBeNull();
  });

  it("개인정보 형태는 거절한다", () => {
    expect(parseExplainResponse({ hint: "123-456-78901 계좌의 돈" }, TARGET)).toBeNull();
  });

  /*
   * 실측에서 드러난 것 — 30자 상한이 이 기능의 존재 이유를 잘라 냈다.
   *
   * `반대매매`(34자) · `세금우대한도조회`(32자) · `랩잔고조회`(32자)가 전부 버려졌다.
   * 모델이 낸 풀이는 멀쩡했다. **어려운 말일수록 풀 말이 길어지는데**, 상한이 하필
   * 그것들만 걸러 낸 것이다. 쉬운 `예수금`(26자)만 통과했으니 규칙이 거꾸로 걸린 셈이다.
   *
   * 빌드 타임은 상한을 그대로 둔다 — 700줄짜리 목록에 묻지도 않은 설명이 두 줄씩
   * 깔리는 것과, 사용자가 <b>직접 물어서</b> 나오는 답은 다르다.
   */
  it("어려운 말은 풀이가 길다 — 물어본 답은 한 줄을 조금 넘겨도 받는다", () => {
    const real = "빌린 돈을 제때 갚지 못하면 주식을 강제로 팔아버리는 일이에요";
    expect(real.length).toBeGreaterThan(30);
    expect(parseExplainResponse({ hint: real }, { label: "반대매매" })).toBe(real);
  });

  it("그래도 문단이 되면 거절한다", () => {
    const long =
      "증권 계좌에 들어 있으면서 아직 주식을 사지 않아 그대로 남아 있는 현금을 말하며 언제든지 찾을 수 있습니다";
    expect(parseExplainResponse({ hint: long }, TARGET)).toBeNull();
  });

  it("모델이 아무것도 못 주면 null이다", () => {
    expect(parseExplainResponse(null, TARGET)).toBeNull();
    expect(parseExplainResponse({}, TARGET)).toBeNull();
    expect(parseExplainResponse({ hint: "" }, TARGET)).toBeNull();
  });
});
