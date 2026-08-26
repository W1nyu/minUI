import { describe, expect, it } from "vitest";
import {
  classifyLexicalSignal,
  isClean,
  overlap,
  type CleanGate,
} from "../src/eval-contamination.js";

/** 기본 문턱. `report:contamination`이 쓰는 것과 같은 값이어야 한다. */
const GATE: CleanGate = { bigram: 0.15, lcs: 0.5, run: 0.5 };

/**
 * "깨끗하다"를 사람 판단이 아니라 코드로 정의한다.
 *
 * <p>기획안 §0이 스스로 적어 둔 흠이 출발점이다 — <b>"질의도 내가 쓰고 동의어도 내가
 * 썼다. 질의 75건 중 49%가 사람이 붙인 동의어와 문자열로 겹치고 10건은 글자까지 같다."</b>
 * 그 겹침이 바로 n-gram이 잘하는 것이라, 기존 세트로는 신경망의 이득이 보이지 않는다.
 * 잘하는 쪽에 유리한 문제만 남겨 두고 "차이가 없다"고 적는 것은 측정이 아니다.
 *
 * <p>그래서 <b>겹침을 계산해서 걸러 낸다.</b> 사람이 "이건 깨끗해 보인다"고 고르면
 * 그 판단 자체가 새로운 오염이 된다. 코드가 재면 다시 돌릴 수 있고, 문턱을 바꿔도
 * 같은 자리에서 다시 잴 수 있다.
 */
describe("overlap — 질의와 정답이 글자를 얼마나 나눠 갖는가", () => {
  it("정답의 표현이 질의에 통째로 들어 있으면 containment 1", () => {
    // 파이프라인 ②(포함 판정)가 그대로 잡는 경우다. 신경망이 나설 자리가 아니다.
    expect(overlap("자동이체 해지하고 싶어", ["자동이체"]).containment).toBe(1);
  });

  it("질의가 정답 표현의 일부여도 containment 1", () => {
    // 반대 방향도 파이프라인이 잡는다 — `partialScore`가 그 자리다.
    expect(overlap("이체", ["계좌이체"]).containment).toBe(1);
  });

  it("글자가 하나도 안 겹치면 전부 0 — 이것이 '깨끗하다'의 정의다", () => {
    const o = overlap("돈 부쳐줘", ["이체", "계좌이체"]);

    expect(o.containment).toBe(0);
    expect(o.bigramJaccard).toBe(0);
    expect(o.lcsRatio).toBe(0);
  });

  it("한 글자만 겹치는 것은 겹친 것으로 세지 않는다", () => {
    // 파이프라인도 한 글자 표현을 포함 판정에서 뺀다. 재는 쪽이 같은 눈을 가져야 한다.
    expect(overlap("돈 부쳐줘", ["돈"]).bigramJaccard).toBe(0);
  });

  it("여러 표현 중 가장 많이 겹치는 것으로 잰다", () => {
    /*
     * 정답 메뉴에 붙은 표현이 하나라도 질의와 겹치면 파이프라인이 그것으로 잡는다.
     * 평균을 내면 나머지 표현들이 그 사실을 희석해 오염을 놓친다.
     */
    const o = overlap("잔액 좀 보자", ["거래내역", "잔액조회"]);

    expect(o.bigramJaccard).toBeGreaterThan(0.15);
  });

  it("정규화를 거친 뒤에 잰다 — 파이프라인이 보는 글자와 같아야 한다", () => {
    // "잔액을"의 조사가 붙어 있어도 파이프라인은 "잔액"을 본다.
    expect(overlap("잔액을 보여줘", ["잔액"]).containment).toBe(1);
  });
});

describe("isClean", () => {
  it("포함이 하나라도 있으면 깨끗하지 않다", () => {
    expect(isClean({ containment: 1, bigramJaccard: 0, lcsRatio: 0, runRatio: 0 }, GATE)).toBe(false);
  });

  it("문턱을 넘는 2-gram 겹침이 있으면 깨끗하지 않다", () => {
    expect(isClean({ containment: 0, bigramJaccard: 0.4, lcsRatio: 0, runRatio: 0 }, GATE)).toBe(false);
  });

  it("넷 다 문턱 아래여야 깨끗하다", () => {
    expect(isClean({ containment: 0, bigramJaccard: 0.05, lcsRatio: 0.2, runRatio: 0.1 }, GATE)).toBe(true);
  });
});

/**
 * 문자열 겹침은 데이터 전체의 유효성을 부정하는 낙인이 아니다.
 *
 * <p>같은 질의도 목적에 따라 쓸모가 다르다. 정답 표현을 그대로 쓴 발화는 검색 회귀와
 * 실제 용어 경로 확인에는 유효하지만, n-gram보다 신경망이 <em>추가로</em> 기여했는지를
 * 재는 대조군은 될 수 없다. 보고서는 이 둘을 분리해야 한다.
 */
describe("classifyLexicalSignal — 평가 용도에 맞게 층위를 나눈다", () => {
  it("글자 신호가 없으면 의미 매칭 효과를 볼 수 있는 semantic-focus다", () => {
    expect(classifyLexicalSignal(overlap("법원에 돈 좀 맡겨야 하는데 어디서 하냐", ["공탁금납부"]))).toBe(
      "semantic-focus",
    );
  });

  it("글자 신호가 있어도 버리지 않고 lexical-support로 남긴다", () => {
    expect(classifyLexicalSignal(overlap("자동이체 해지하고 싶어", ["자동이체"]))).toBe(
      "lexical-support",
    );
  });
});

/**
 * 긴 질의가 짧은 정답을 통째로 품는 경우.
 *
 * <p>자카드는 <b>길이에 민감하다.</b> 질의가 길면 정답의 글자를 다 써도 겹침 비율이
 * 낮게 나온다. 실제로 `"공탁금 걸어야 하니까 그 화면 좀 띄워봐"`가 `공탁금납부`를
 * 상대로 필터를 통과했다 — 라벨 다섯 글자 중 셋을 그대로 쓰는데도.
 *
 * <p>그 질의는 <b>n-gram이 바로 잡는다.</b> 어디서 왔든(모델이 용어를 알았든) 신경망의
 * 이득을 재는 데는 못 쓴다. 그래서 <b>정답 쪽 길이를 기준으로</b> 한 번 더 본다.
 */
describe("runRatio — 정답의 이름을 얼마나 가져다 썼는가", () => {
  it("긴 질의가 짧은 정답을 품으면 잡힌다", () => {
    const o = overlap("공탁금 걸어야 하니까 그 화면 좀 띄워봐", ["공탁금납부"]);

    expect(o.bigramJaccard).toBeLessThan(0.15); // 자카드는 못 잡는다
    expect(o.runRatio).toBeGreaterThan(0.5); // 이쪽이 잡는다
    expect(isClean(o, GATE)).toBe(false);
  });

  it("뜻만 같고 글자가 다르면 통과한다", () => {
    // 정확히 이런 것이 재고 싶은 질의다 — n-gram이 0점을 주는 자리.
    const o = overlap("법원에 돈 좀 맡겨야 하는데 어디서 하냐", ["공탁금납부"]);

    expect(isClean(o, GATE)).toBe(true);
  });

  it("한 글자 겹침은 세지 않는다", () => {
    expect(overlap("돈 어디 있나", ["공탁금납부"]).runRatio).toBe(0);
  });
});
