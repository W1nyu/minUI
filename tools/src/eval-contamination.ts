import { normalize } from "@minui/core";

/**
 * 질의와 정답이 글자를 얼마나 나눠 갖는가 — **오염도를 코드가 잰다.**
 *
 * <h3>왜 필요한가</h3>
 * 기획안 §0이 스스로 적어 둔 흠이 출발점이다:
 * <blockquote>질의도 내가 쓰고 동의어도 내가 썼다. 질의 75건 중 49%가 사람이 붙인
 * 동의어와 문자열로 겹치고 10건은 글자까지 같다.</blockquote>
 *
 * <p>그 겹침이 <b>정확히 n-gram이 잘하는 것</b>이다. 기존 세트로 신경망을 재면 잘하는
 * 쪽에 유리한 문제만 남겨 두고 "차이가 없다"는 결론을 얻게 된다 — 그것은 측정이 아니라
 * 측정의 흉내다. M4에서 n-gram의 기여가 정확히 0으로 나온 것도 같은 세트에서였다.
 *
 * <h3>왜 사람이 고르지 않는가</h3>
 * "이건 깨끗해 보인다"고 사람이 고르면 <b>그 판단이 새로운 오염</b>이 된다. 코드가 재면
 * 다시 돌릴 수 있고, 문턱을 바꿔도 같은 자리에서 다시 잴 수 있고, 무엇보다
 * <b>검증자를 검증할 수 있다</b> — `report:contamination`이 §0의 자기 진단(49% / 10건)을
 * 재현하지 못하면 이 필터가 틀린 것이다.
 *
 * <h3>파이프라인이 보는 글자를 본다</h3>
 * `normalize()`를 거친 뒤에 잰다. 조사·어미가 붙은 채로 재면 "잔액을"과 "잔액"이 다른
 * 것으로 보이는데, 파이프라인은 그 둘을 같게 본다. <b>재는 자와 재는 대상이 다른 글자를
 * 보면 결과가 실제 동작을 말하지 않는다.</b>
 */

export interface Overlap {
  /**
   * 정답의 어떤 표현이 질의에 통째로 들어 있는가(또는 그 반대). 0 또는 1.
   *
   * <p>1이면 파이프라인 ②(포함 판정)가 그대로 잡는다 — 신경망이 나설 자리가 아니다.
   */
  containment: number;
  /** 문자 2-gram 자카드 최댓값. <b>n-gram 단계가 쓰는 것과 같은 신호다.</b> */
  bigramJaccard: number;
  /** 최장 공통 부분문자열 길이 ÷ 질의 길이. */
  lcsRatio: number;
  /**
   * 최장 공통 부분문자열 길이 ÷ <b>정답 표현</b> 길이. 0..1.
   *
   * <p>`lcsRatio`가 질의 쪽 길이로 나누는 것과 반대다. 자카드도 `lcsRatio`도 질의가 길면
   * 값이 낮게 나와서, <b>긴 질의가 짧은 정답을 통째로 품는 경우</b>를 놓친다 —
   * "공탁금 걸어야 하니까 그 화면 좀 띄워봐"가 `공탁금납부`를 상대로 그랬다.
   * 그런 질의는 n-gram이 바로 잡으므로 신경망의 이득을 재는 데 못 쓴다.
   */
  runRatio: number;
}

export interface CleanGate {
  bigram: number;
  lcs: number;
  /** 정답 이름을 이 비율 이상 가져다 쓰면 깨끗하지 않다. */
  run: number;
}

/** 기본 문턱. 바꾸면 `report:contamination`이 그 값으로 다시 잰다. */
export const DEFAULT_GATE: CleanGate = { bigram: 0.15, lcs: 0.5, run: 0.5 };

/**
 * 평가 질의가 <em>무엇을</em> 검증할 수 있는지 나타내는 층위.
 *
 * <p>문자열 신호가 있는 실제 발화를 "오염"이나 "무효"라고 부르지 않는다. 그런 질의는
 * 포함·n-gram·동의어 경로의 회귀를 지키는 데 꼭 필요하다. 다만 그 경로를 제거한 뒤에도
 * 신경망이 추가 이득을 내는지 보려면, 문자 신호가 없는 대조군을 따로 봐야 한다.
 */
export type LexicalSignal = "semantic-focus" | "lexical-support";

/**
 * @param terms 정답 메뉴의 <b>모든</b> 표현(라벨 + 동의어). `MenuIndex.documents()`가
 *   파이프라인에 넘기는 것과 같아야 한다 — 하나라도 겹치면 파이프라인이 그것으로 잡는다.
 */
export function overlap(query: string, terms: readonly string[]): Overlap {
  const q = normalize(query);
  const normalized = terms.map((term) => normalize(term)).filter((term) => term.length > 0);

  if (q.length === 0 || normalized.length === 0) {
    return { containment: 0, bigramJaccard: 0, lcsRatio: 0, runRatio: 0 };
  }

  let containment = 0;
  let bigramJaccard = 0;
  let lcsRatio = 0;
  let runRatio = 0;

  for (const term of normalized) {
    /*
     * 한 글자 표현은 세지 않는다. 파이프라인도 포함 판정에서 한 글자를 빼는데,
     * 이유가 같다 — "돈" 한 글자는 긴 질의 어디에나 걸려 아무것도 구분하지 못한다.
     */
    if (term.length >= 2 && (q.includes(term) || term.includes(q))) containment = 1;

    const run = longestCommon(q, term);
    bigramJaccard = Math.max(bigramJaccard, jaccard(bigrams(q), bigrams(term)));
    lcsRatio = Math.max(lcsRatio, run / q.length);
    runRatio = Math.max(runRatio, run / term.length);
  }

  return { containment, bigramJaccard, lcsRatio, runRatio };
}

/**
 * 이 질의는 신경망을 재는 데 쓸 수 있는가.
 *
 * <p>셋 다 문턱 아래여야 한다. <b>이 조건을 통과하면 포함 판정은 구조적으로 걸리지 않고
 * n-gram 단계에는 쓸 신호가 거의 없다</b> — 그것이 "깨끗하다"의 기계적 정의다.
 */
export function isClean(o: Overlap, gate: CleanGate = DEFAULT_GATE): boolean {
  return (
    o.containment === 0 &&
    o.bigramJaccard < gate.bigram &&
    o.lcsRatio < gate.lcs &&
    o.runRatio < gate.run
  );
}

/**
 * 이 질의를 버리지 않고, 검증 질문에 맞는 층위로 분류한다.
 *
 * <p>`semantic-focus`는 의미 매칭의 <b>추가</b> 이득을 볼 대조군이고,
 * `lexical-support`는 평소 표현·정확 매칭·n-gram 경로의 회귀를 재는 표본이다. 둘의
 * 정확도를 한 숫자로 합쳐 "신경망의 효과"라고 주장하면 안 되지만, 어느 쪽도 무효가 아니다.
 */
export function classifyLexicalSignal(
  o: Overlap,
  gate: CleanGate = DEFAULT_GATE,
): LexicalSignal {
  return isClean(o, gate) ? "semantic-focus" : "lexical-support";
}

/**
 * 이 글과 표현들이 <b>몇 글자짜리 조각을 나눠 갖는가</b> (정규화 후 최댓값).
 *
 * <p>`overlap`의 `containment`는 표현이 <b>통째로</b> 들어 있는지만 본다. 그것으로는
 * `신상펀드`와 "새로 나온 <b>펀드</b> 상품"의 누출을 못 잡는다 — 조각만 겹치기 때문이다.
 * 문항지 봉투는 그 조각도 막아야 한다. 참가자는 통째 포함이 아니라 <b>눈에 띄는 조각</b>을
 * 따라 쓴다.
 */
export function sharedRun(text: string, terms: readonly string[]): number {
  const t = normalize(text);
  if (t.length === 0) return 0;

  let best = 0;
  for (const term of terms) {
    const normalized = normalize(term);
    if (normalized.length === 0) continue;
    best = Math.max(best, longestCommon(t, normalized));
  }
  return best;
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  // 한 글자짜리는 그대로 넣는다. 버리면 짧은 라벨이 아무와도 안 겹치는 것으로 보인다.
  if (text.length < 2) {
    if (text.length === 1) grams.add(text);
    return grams;
  }
  for (let i = 0; i + 2 <= text.length; i++) grams.add(text.slice(i, i + 2));
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** 최장 공통 부분문자열. 두 글자 미만은 우연이라 0으로 본다. */
function longestCommon(a: string, b: string): number {
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      current[j] = previous[j - 1]! + 1;
      if (current[j]! > best) best = current[j]!;
    }
    previous = current;
  }

  return best >= 2 ? best : 0;
}
