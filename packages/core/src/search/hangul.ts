/**
 * 한글 자모 처리 (기획안 §8.3 ④).
 *
 * STT는 고령 사용자 발화에서 오인식률이 올라간다 — "이체"를 "이제", "체크"로 받는 식이다.
 * 글자 단위로 비교하면 두 글자 중 하나가 틀린 것이라 50% 차이지만, 자모로 풀면
 * 네 개 중 하나라 25% 차이다. 이 감도 차이가 복구력을 만든다.
 */

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const LEAD_BASE = 0x1100;
const VOWEL_BASE = 0x1161;
const TAIL_BASE = 0x11a7;
const VOWEL_COUNT = 21;
const TAIL_COUNT = 28;

/** 음절을 초성·중성·종성으로 푼다. 한글이 아닌 문자는 그대로 통과시킨다. */
export function toJamo(text: string): string[] {
  const out: string[] = [];

  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < SYLLABLE_BASE || code > SYLLABLE_LAST) {
      out.push(char);
      continue;
    }

    const index = code - SYLLABLE_BASE;
    const lead = Math.floor(index / (VOWEL_COUNT * TAIL_COUNT));
    const vowel = Math.floor((index % (VOWEL_COUNT * TAIL_COUNT)) / TAIL_COUNT);
    const tail = index % TAIL_COUNT;

    out.push(String.fromCharCode(LEAD_BASE + lead));
    out.push(String.fromCharCode(VOWEL_BASE + vowel));
    // 겹받침(ㄳ, ㄵ…)은 더 쪼개지 않는다. 오인식 복구에는 한 단위로 충분하고,
    // 쪼개면 받침 있는 글자만 거리가 과하게 벌어진다.
    if (tail > 0) out.push(String.fromCharCode(TAIL_BASE + tail));
  }

  return out;
}

/** 자모 수준 편집 거리. */
export function jamoDistance(a: string, b: string): number {
  return levenshtein(toJamo(a), toJamo(b));
}

/**
 * `needle`이 `haystack` 안에 (오인식을 감안해) 얼마나 들어 있는가. 0..1.
 *
 * 방향이 있다는 점이 중요하다. 사용자는 "자동이체 안 나가게 해야 하는데"처럼 길게 말하고,
 * 찾아야 하는 것은 그 안의 "자동이체"다. 전체 길이로 정규화하면 짧은 메뉴 이름은
 * 문장이 길어질수록 점수가 떨어져 영원히 임계치를 못 넘는다.
 * 그래서 needle을 haystack의 **어느 위치에든** 맞춰 보고, needle 길이로만 나눈다.
 */
export function jamoSimilarity(haystack: string, needle: string): number {
  const source = toJamo(haystack);
  const target = toJamo(needle);

  if (target.length === 0 && source.length === 0) return 1;
  if (target.length === 0 || source.length === 0) return 0;

  const edits = infixDistance(source, target);
  return Math.max(0, 1 - edits / target.length);
}

function levenshtein(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j]! + 1, current[j - 1]! + 1);
    }
    previous = current;
  }

  return previous[b.length]!;
}

/**
 * `target`을 `source`의 어느 부분과 맞출 때의 최소 편집 수.
 * 일반 편집 거리에서 시작 위치와 끝 위치를 자유롭게 둔 것이다.
 */
function infixDistance(source: readonly string[], target: readonly string[]): number {
  // 첫 행을 0으로 채워 source의 어느 지점에서 시작해도 비용이 없게 한다.
  let previous = new Array<number>(source.length + 1).fill(0);

  for (let i = 1; i <= target.length; i++) {
    const current = [i];
    for (let j = 1; j <= source.length; j++) {
      const substitution = previous[j - 1]! + (target[i - 1] === source[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j]! + 1, current[j - 1]! + 1);
    }
    previous = current;
  }

  // 마지막 행의 최솟값 = source의 어느 지점에서 끝나도 되는 경우의 최소 비용.
  return Math.min(...previous);
}
