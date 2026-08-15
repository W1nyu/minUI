import { jamoDistance, toJamo } from "./hangul.js";
import { normalize } from "./normalize.js";

/**
 * 발화에서 값을 뽑는다 — **음성 프리필의 재료** (M9, 기획안 §9.3).
 *
 * <p>여기 있는 것은 <b>한국어 처리이지 금융 도메인이 아니다.</b> `normalize`(조사·어미)와
 * `hangul`(자모)이 core에 있는 것과 같은 이유로 여기 있다. 무엇이 수취인이고 무엇이
 * 금액인지는 호스트가 정하고, 엔진은 "이 목록 중 하나"와 "얼마"를 한국어에서 읽어낼 뿐이다.
 * 계좌·수취인 목록은 호스트만 아는 것이므로 인자로 받는다.
 *
 * <p><b>어순을 보지 않는다.</b> 사람은 "엄마한테 3만원"이라고도 하고 "3만원 엄마한테"라고도
 * 한다. 자리로 파싱하면 둘 중 하나는 반드시 놓치고, 그러면 사용자는 어떤 순서로 말해야
 * 하는지를 배워야 한다 — UI가 사용자에게 적응하라고 요구하는 것이 이 프로젝트가
 * 없애려는 바로 그것이다.
 */

/** 한글 수사. 십·백·천은 자리이고 만·억은 묶음이다. */
const DIGITS: Record<string, number> = {
  영: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9,
};
const PLACES: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const GROUPS: Record<string, number> = { 만: 10_000, 억: 100_000_000 };

const AMOUNT_CHARS = /[0-9영일이삼사오육칠팔구십백천만억]/u;

/**
 * 발화에서 금액을 읽는다. 못 읽으면 `null`.
 *
 * <p><b>단위가 없으면 읽지 않는다.</b> 이 판단이 이 함수에서 가장 중요하다 — 돈을 다루는
 * 자리에서 "아마 금액일 것"은 근거가 아니다. `원`이 붙거나 `만`·`억`이 있을 때만 금액으로
 * 본다. 그래서 `"30일에 나가는 거"`의 30도, `"3번 계좌"`의 3도 금액이 아니다.
 *
 * <p>대가는 `"오천 보내줘"`처럼 단위를 뺀 말을 못 읽는 것이다. 비어 있는 칸은 사용자가
 * 채우면 되지만 <b>잘못 채워진 금액은 사용자가 알아채야만 고쳐진다.</b> 그쪽이 싸다.
 */
export function parseAmount(query: string): number | null {
  const text = query.replace(/[\s,]/gu, "");

  for (let i = 0; i < text.length; i++) {
    if (!AMOUNT_CHARS.test(text[i]!)) continue;

    let end = i;
    while (end < text.length && AMOUNT_CHARS.test(text[end]!)) end++;

    const run = text.slice(i, end);
    const hasWon = text[end] === "원";
    const hasGroup = /[만억]/u.test(run);

    // 금액이라고 볼 근거가 있을 때만 읽는다.
    if (hasWon || hasGroup) {
      const value = evaluate(run);
      if (value !== null && value > 0) return value;
    }

    i = end;
  }

  return null;
}

/**
 * 한글·아라비아가 섞인 수를 값으로. `"3만5천"` · `"이십오만"` · `"30000"`.
 *
 * 자리(십·백·천)는 더해 나가고 묶음(만·억)에서 확정한다. 한국어 수 체계가 그렇게
 * 생겼기 때문이고, 이렇게 두면 두 표기가 섞여도 같은 경로로 계산된다.
 */
function evaluate(run: string): number | null {
  let total = 0;
  let section = 0;
  let current = 0;
  let sawDigit = false;

  for (const char of run) {
    if (char >= "0" && char <= "9") {
      current = current * 10 + Number(char);
      sawDigit = true;
      continue;
    }

    const digit = DIGITS[char];
    if (digit !== undefined) {
      current = digit;
      sawDigit = true;
      continue;
    }

    const place = PLACES[char];
    if (place !== undefined) {
      // "십만"처럼 앞에 수가 없으면 1로 본다.
      section += (current || 1) * place;
      current = 0;
      sawDigit = true;
      continue;
    }

    const group = GROUPS[char];
    if (group !== undefined) {
      total += (section + current || 1) * group;
      section = 0;
      current = 0;
      sawDigit = true;
    }
  }

  if (!sawDigit) return null;
  return total + section + current;
}

export interface PickOptions {
  /**
   * 자모 유사도가 이 아래면 고르지 않는다.
   *
   * <p>기본값은 `search.phoneticFloor`와 같은 0.75다. 같은 문제(STT 오인식)를 같은 세기로
   * 흡수해야 화면마다 다르게 동작하지 않는다.
   */
  floor?: number;
  /**
   * 1등과 2등의 점수 차가 이보다 작으면 고르지 않는다.
   *
   * <p>검색의 동점 규칙보다 <b>훨씬 크다.</b> 메뉴는 잘못 열려도 다시 나오면 그만이지만,
   * <b>이름은 한 음절만 달라도 다른 사람이다.</b> `김철수`와 `김철순` 사이에서 찍으면
   * 남의 계좌가 채워진 화면이 열린다. 비어 있는 칸은 사용자가 채우면 되지만,
   * 잘못 채워진 칸은 사용자가 알아채야만 고쳐진다.
   */
  margin?: number;
}

/**
 * 발화 안에서 목록 중 하나를 고른다. 못 고르면 `null`.
 *
 * <p><b>누구에게 보내는지를 잘못 고르는 것은 이 기능이 할 수 있는 가장 나쁜 실수다.</b>
 * 비어 있는 칸은 사용자가 채우면 되지만, 잘못 채워진 칸은 사용자가 알아채야만 고쳐진다.
 * 그래서 애매하면 고르지 않는다 — 목록에 없으면, 너무 짧으면, 두 후보가 비슷하면.
 *
 * @param choices 호스트가 아는 값들 (최근 수취인, 계좌 별명 등)
 */
export function pickFromList(
  query: string,
  choices: readonly string[],
  { floor = 0.75, margin = 0.15 }: PickOptions = {},
): string | null {
  const text = normalize(query);
  if (text.length === 0) return null;

  const scored: { choice: string; score: number }[] = [];

  for (const choice of choices) {
    const term = normalize(choice);
    // 한 글자는 문장 어디에나 걸린다. 검색 파이프라인이 포함 판정에서 한 글자를
    // 제외하는 것과 같은 이유다.
    if (term.length < 2) continue;

    scored.push({ choice, score: bestScore(text, term, choice) });
  }

  /*
   * **사용자가 그 이름을 그대로 말했으면 그것이다.**
   *
   * 유사도만으로 재면 `김철수`와 `김철순`의 차이가 0.04밖에 안 되어 아래 마진에 걸려
   * 둘 다 버려진다. 그러면 이름을 또박또박 말한 사람에게 아무것도 채워지지 않는다.
   * 정확히 들어 있는 것은 유사도와 다른 층위의 근거이므로 먼저 본다 —
   * 검색 파이프라인이 정확 매칭을 독점 단계로 두는 것과 같은 판단이다.
   */
  const exact = scored.filter((entry) => entry.score === 1);
  if (exact.length === 1) return exact[0]!.choice;
  // 같은 이름이 둘이면 고를 수 없다. 사용자가 목록에서 직접 고르는 편이 낫다.
  if (exact.length > 1) return null;

  scored.sort((a, b) => b.score - a.score);

  const first = scored[0];
  if (!first || first.score < floor) return null;

  const second = scored[1];
  if (second && first.score - second.score < margin) return null;

  return first.choice;
}

/**
 * 이 표현이 질의 안에 얼마나 있는가.
 *
 * @param original 공백이 살아 있는 원본. 낱말 단위 판정에 쓴다.
 */
function bestScore(text: string, term: string, original: string): number {
  if (text.includes(term)) return 1;

  /*
   * **긴 이름은 한 낱말로 불린다.** 사람은 `행복아파트 관리사무소`를
   * "관리사무소에 보내야 해"라고 부른다. 통째로 비교하면 영영 안 걸리고, 글자 단위로
   * 잘라 비교하면 `행복`·`아파트` 같은 흔한 조각이 아무 데나 걸린다.
   * 이름을 지은 사람이 나눠 놓은 단위(공백)가 사람이 부르는 단위이기도 하다.
   */
  for (const word of original.split(/\s+/u)) {
    const part = normalize(word);
    if (part.length >= 3 && text.includes(part)) return 0.95;
  }

  /*
   * 오인식 복구 — <b>같은 길이의 창을 밀며</b> 자모 유사도의 최댓값을 본다.
   * 문장 전체와 비교하면 긴 문장에서 짧은 이름이 영영 문턱을 못 넘는다:
   * `"업마한테 보내줘"`와 `"엄마"`의 유사도는 낮지만 `"업마"`와 `"엄마"`는 높다.
   */
  let best = 0;
  for (let i = 0; i + term.length <= text.length; i++) {
    best = Math.max(best, symmetric(text.slice(i, i + term.length), term));
  }
  return best;
}

/**
 * 두 표현이 서로 얼마나 같은가. 0..1. **방향이 없다.**
 *
 * <p>검색이 쓰는 `jamoSimilarity`를 여기서 쓰면 안 된다. 그쪽은 <b>"이 표현이 문장 안에
 * 들어 있는가"</b>를 재는 infix 판정이라, `김철수`가 `김철순` 안에 들어 있다고 본다 —
 * 끝의 받침 하나를 떼는 데 값이 들지 않기 때문이다. 메뉴를 찾을 때는 그것이 옳지만
 * (`"자동이체 안 나가게"` 안의 `자동이체`), <b>이름에서는 받침 하나가 다른 사람이다.</b>
 *
 * <p>그래서 자리를 찾는 일(창 밀기)과 같은지 보는 일(이 함수)을 나눴다.
 */
function symmetric(a: string, b: string): number {
  const length = Math.max(toJamo(a).length, toJamo(b).length);
  if (length === 0) return 1;
  return Math.max(0, 1 - jamoDistance(a, b) / length);
}
