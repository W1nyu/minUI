import { describe, expect, it } from "vitest";
import { QUERY_SCHEMA, buildQueryPrompt, keepClean } from "../src/eval-queries.js";

/**
 * 모델에게 질의를 받되, **정답을 보여 주지 않는다.**
 *
 * <p>§0의 흠은 "질의도 내가 쓰고 동의어도 내가 썼다"였다. 모델을 시키는 것으로 그것이
 * 저절로 고쳐지지는 않는다 — <b>프롬프트에 라벨이나 동의어가 한 글자라도 새면 같은
 * 오염이 그대로 재현된다.</b> 사람 대신 모델이 베낄 뿐이다.
 *
 * <p>그래서 프롬프트를 코드가 검사한다. 이 describe가 이 작업에서 가장 중요한 자리다.
 */
describe("buildQueryPrompt — 정답이 프롬프트에 새는가", () => {
  const envelope = {
    menuId: "shinhan.acctinfo",
    expect: "어카운트인포",
    synonyms: ["계좌 모아보기", "숨은 계좌"],
    shown: "모든 은행 계좌 한 번에 찾기",
    context: ["개인뱅킹", "조회"],
  };

  it("라벨이 프롬프트에 안 들어간다", () => {
    expect(buildQueryPrompt(envelope, 5)).not.toContain("어카운트인포");
  });

  it("동의어가 프롬프트에 안 들어간다", () => {
    const prompt = buildQueryPrompt(envelope, 5);

    for (const synonym of envelope.synonyms) expect(prompt).not.toContain(synonym);
  });

  it("메뉴 id도 안 들어간다 — id에 영문 힌트가 박혀 있다", () => {
    // `shinhan.acctinfo`의 `acctinfo`는 라벨을 그대로 옮긴 것이다.
    expect(buildQueryPrompt(envelope, 5)).not.toContain("acctinfo");
  });

  it("보여 줄 설명과 갈래는 들어간다 — 이것이 없으면 질의를 쓸 수 없다", () => {
    const prompt = buildQueryPrompt(envelope, 5);

    expect(prompt).toContain("모든 은행 계좌 한 번에 찾기");
    expect(prompt).toContain("개인뱅킹");
  });

  it("몇 개를 달라고 할지 프롬프트에 적힌다", () => {
    expect(buildQueryPrompt(envelope, 7)).toContain("7");
  });

  it("스키마는 문자열 배열을 요구한다", () => {
    // 모델이 형태를 어기면 통째로 버린다. 고쳐 쓰기 시작하면 그것이 또 내 손이다.
    expect(QUERY_SCHEMA).toMatchObject({
      type: "object",
      required: ["queries"],
    });
  });
});

/**
 * 받은 것을 그대로 믿지 않는다.
 *
 * <p>모델이 봉투만 보고 썼어도 <b>우연히 정답의 글자를 맞힐 수 있다.</b> 금융 용어는
 * 어휘가 좁아서 그럴 확률이 낮지 않다. 받은 뒤 같은 필터로 한 번 더 거른다.
 */
describe("keepClean — 받은 질의를 다시 거른다", () => {
  const terms = ["어카운트인포", "계좌 모아보기"];

  it("정답의 글자가 겹치는 것은 버린다", () => {
    const kept = keepClean(["계좌 모아보기 해줘", "내 통장 다 보여줘"], terms);

    expect(kept).toEqual(["내 통장 다 보여줘"]);
  });

  it("너무 짧은 것은 버린다 — 한두 글자는 질의가 아니다", () => {
    expect(keepClean(["돈", "가"], terms)).toEqual([]);
  });

  it("같은 말이 두 번 오면 하나만 남긴다", () => {
    const kept = keepClean(["내 통장 다 보여줘", "내 통장 다 보여줘"], terms);

    expect(kept).toHaveLength(1);
  });

  it("앞뒤 공백과 따옴표를 털어 낸다", () => {
    // 모델이 따옴표째로 돌려주는 일이 있다. 그대로 두면 정규화가 다르게 걸린다.
    expect(keepClean(['  "내 통장 다 보여줘"  '], terms)).toEqual(["내 통장 다 보여줘"]);
  });
});
