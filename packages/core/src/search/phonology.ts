/**
 * 발음 표기 (기획안 §8.3 ④-2 — M21).
 *
 * <p>STT는 들은 것을 <b>소리나는 대로</b> 적는다. "잔액 조회"라고 말해도 `자낵조회`로,
 * "적금"이라고 말해도 `적끔`으로 적히는 일이 흔하다. 글자로 비교하면 이 둘은 다른 말이지만
 * 소리로 비교하면 같은 말이다.
 *
 * <p><b>이 파일이 다른 검색 개선과 다른 점.</b> 재순위·하이브리드 회수·뜻풀이 색인은 전부
 * 같은 벽에 부딪혔다 — 메뉴 라벨 안에 사용자가 쓰는 말이 없다(§16). 없는 정보는 어떤 모델도
 * 만들지 못한다. 그런데 <b>소리는 라벨 안에 이미 있다.</b> 필요한 것은 새 어휘가 아니라
 * 음운 대응 규칙이고, 그것은 규칙으로 적을 수 있다.
 *
 * <p>질의와 라벨 <b>양쪽에 같은 변환</b>을 건다. 목적은 언어학적 완전성이 아니라 두 문자열이
 * 같은 공간에 오는 것이다. `normalize()`가 공백을 지운 뒤에 걸리므로 어절 경계를 넘는 연음이
 * 생기지만, 양쪽이 같은 처리를 받으므로 대응은 유지된다.
 *
 * <p>사전도 형태소 분석기도 쓰지 않는다 — 순수 함수 하나이고 의존성이 0이다. 그래서
 * 다른 언어로 포팅할 때 `fixtures/phonology.json`이 그대로 재사용된다.
 */

/**
 * 발음 표기 단계의 설정 (불변 규칙 3 — 튜닝 값은 코드에 하드코딩하지 않는다).
 */
export interface PhonologySettings {
  /**
   * 소리로 한 번 더 맞춰 볼 것인가.
   *
   * <p>기본은 `false`다. `neural`과 같은 처분으로, 사전 등록한 게이트를
   * `bench:voice`가 통과시키기 전에는 켜지 않는다.
   */
  enabled: boolean;
  /**
   * 소리가 정확히 같을 때 주는 점수.
   *
   * <p>`exact`(1.00) 아래에 둔다 — 글자가 같은 것이 소리가 같은 것보다 강한 근거이고,
   * 소리 충돌이 `DECISIVE` 필터를 가로채면 정답이 후보에서 통째로 사라진다.
   */
  soundWeight: number;
}

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const VOWEL_COUNT = 21;
const TAIL_COUNT = 28;

// 초성 인덱스
const L_G = 0;
const L_GG = 1;
const L_N = 2;
const L_D = 3;
const L_DD = 4;
const L_R = 5;
const L_M = 6;
const L_B = 7;
const L_BB = 8;
const L_S = 9;
const L_SS = 10;
const L_IEUNG = 11;
const L_J = 12;
const L_JJ = 13;
const L_CH = 14;
const L_K = 15;
const L_T = 16;
const L_P = 17;
const L_H = 18;

// 중성 인덱스
const V_I = 20;

// 종성 인덱스
const T_NONE = 0;
const T_G = 1;
const T_GG = 2;
const T_GS = 3;
const T_N = 4;
const T_NJ = 5;
const T_NH = 6;
const T_D = 7;
const T_R = 8;
const T_RG = 9;
const T_RM = 10;
const T_RB = 11;
const T_RS = 12;
const T_RT = 13;
const T_RP = 14;
const T_RH = 15;
const T_M = 16;
const T_B = 17;
const T_BS = 18;
const T_S = 19;
const T_SS = 20;
const T_NG = 21;
const T_J = 22;
const T_CH = 23;
const T_K = 24;
const T_T = 25;
const T_P = 26;
const T_H = 27;

interface Syllable {
  lead: number;
  vowel: number;
  tail: number;
}

type Unit = Syllable | string;

/** 겹받침을 나눠 뒤로 넘길 때 — [남는 받침, 넘어가는 초성]. */
const CLUSTER_LINK: Record<number, readonly [number, number]> = {
  // ㅅ 계열은 넘어가면서 된소리가 된다: 값이[갑씨], 넋이[넉씨]
  [T_GS]: [T_G, L_SS],
  [T_RS]: [T_R, L_SS],
  [T_BS]: [T_B, L_SS],
  [T_NJ]: [T_N, L_J],
  [T_RG]: [T_R, L_G],
  [T_RM]: [T_R, L_M],
  [T_RB]: [T_R, L_B],
  [T_RT]: [T_R, L_T],
  [T_RP]: [T_R, L_P],
  // ㅎ은 소리를 잃고 앞 자음만 넘어간다: 많아[마나], 싫어[시러]
  [T_NH]: [T_NONE, L_N],
  [T_RH]: [T_NONE, L_R],
};

/** 홑받침이 뒤 음절 초성으로 넘어갈 때의 대응. */
const TAIL_TO_LEAD: Record<number, number> = {
  [T_G]: L_G,
  [T_GG]: L_GG,
  [T_N]: L_N,
  [T_D]: L_D,
  [T_R]: L_R,
  [T_M]: L_M,
  [T_B]: L_B,
  [T_S]: L_S,
  [T_SS]: L_SS,
  [T_J]: L_J,
  [T_CH]: L_CH,
  [T_K]: L_K,
  [T_T]: L_T,
  [T_P]: L_P,
};

/** 겹받침이 그 자리에 남을 때의 대표음. */
const CLUSTER_ALONE: Record<number, number> = {
  [T_GS]: T_G,
  [T_NJ]: T_N,
  [T_NH]: T_N,
  [T_RG]: T_G,
  [T_RM]: T_M,
  [T_RB]: T_R,
  [T_RS]: T_R,
  [T_RT]: T_R,
  [T_RP]: T_B,
  [T_RH]: T_R,
  [T_BS]: T_B,
};

/** 종성 중화 — 받침은 ㄱㄴㄷㄹㅁㅂㅇ 일곱 개로 줄어든다. */
const NEUTRALIZE: Record<number, number> = {
  [T_GG]: T_G,
  [T_K]: T_G,
  [T_S]: T_D,
  [T_SS]: T_D,
  [T_J]: T_D,
  [T_CH]: T_D,
  [T_T]: T_D,
  [T_H]: T_D,
  [T_P]: T_B,
};

/** 받침 ㅎ이 뒤 예사소리를 거센소리로 만든다. */
const ASPIRATE_AFTER_H: Record<number, number> = {
  [L_G]: L_K,
  [L_D]: L_T,
  [L_J]: L_CH,
  [L_S]: L_SS,
};

/** 받침이 뒤 ㅎ을 만나 거센소리가 될 때 — [넘어가는 초성, 남는 받침]. */
const ASPIRATE_BEFORE_H: Record<number, readonly [number, number]> = {
  [T_G]: [L_K, T_NONE],
  [T_RG]: [L_K, T_R],
  [T_D]: [L_T, T_NONE],
  [T_B]: [L_P, T_NONE],
  [T_RB]: [L_P, T_R],
  [T_J]: [L_CH, T_NONE],
};

/** ㅎ을 품은 받침 — 값은 ㅎ을 뺀 나머지 받침이다. */
const H_CARRIER: Record<number, number> = {
  [T_H]: T_NONE,
  [T_NH]: T_N,
  [T_RH]: T_R,
};

/** 예사소리 → 된소리. */
const TENSE: Record<number, number> = {
  [L_G]: L_GG,
  [L_D]: L_DD,
  [L_B]: L_BB,
  [L_S]: L_SS,
  [L_J]: L_JJ,
};

/** 경음화를 일으키는 받침 — 중화된 뒤의 ㄱㄷㅂ. */
const TENSING_TAILS: ReadonlySet<number> = new Set([T_G, T_D, T_B]);

/** 한자어에서 ㄹ 받침 뒤에 된소리가 되는 초성 — 결제[결쩨], 발전[발쩐]. */
const TENSE_AFTER_R: ReadonlySet<number> = new Set([L_D, L_S, L_J]);

/** 비음 앞에서 콧소리가 되는 받침. */
const NASALIZE: Record<number, number> = {
  [T_G]: T_NG,
  [T_D]: T_N,
  [T_B]: T_M,
};

/** 뒤따르는 ㄹ을 ㄴ으로 바꾸는 받침. */
const R_TO_N_TAILS: ReadonlySet<number> = new Set([T_G, T_B, T_M, T_NG]);

/**
 * 표준 발음법으로 다시 쓴다. 한글이 아닌 문자는 그대로 통과하며 앞뒤 음운 규칙을 끊는다.
 *
 * <p>입력은 `normalize()`를 지난 문자열을 기대하지만 아무 문자열이나 넣어도 안전하다.
 */
export function pronounce(text: string): string {
  const units = decompose(text);
  if (units.length === 0) return "";

  linkAndAspirate(units);
  reduceTails(units);
  assimilate(units);

  return compose(units);
}

function decompose(text: string): Unit[] {
  const units: Unit[] = [];

  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (code < SYLLABLE_BASE || code > SYLLABLE_LAST) {
      units.push(char);
      continue;
    }
    const index = code - SYLLABLE_BASE;
    units.push({
      lead: Math.floor(index / (VOWEL_COUNT * TAIL_COUNT)),
      vowel: Math.floor((index % (VOWEL_COUNT * TAIL_COUNT)) / TAIL_COUNT),
      tail: index % TAIL_COUNT,
    });
  }

  return units;
}

function compose(units: readonly Unit[]): string {
  let out = "";
  for (const unit of units) {
    if (typeof unit === "string") {
      out += unit;
      continue;
    }
    out += String.fromCharCode(
      SYLLABLE_BASE + (unit.lead * VOWEL_COUNT + unit.vowel) * TAIL_COUNT + unit.tail,
    );
  }
  return out;
}

/**
 * 1차 통과 — 음절 경계를 다시 긋는 규칙들. 구개음화 → ㅎ 축약 → 연음 순이다.
 *
 * <p>왼쪽에서 오른쪽으로 한 번만 지난다. 각 경계가 <b>지금까지 바뀐 상태</b>를 읽으므로
 * 연쇄가 자연스럽게 일어난다.
 */
function linkAndAspirate(units: readonly Unit[]): void {
  for (let i = 0; i < units.length - 1; i++) {
    // 반복 범위가 두 자리를 보장한다.
    const left = units[i]!;
    const right = units[i + 1]!;
    if (typeof left === "string" || typeof right === "string") continue;
    if (left.tail === T_NONE) continue;

    // 구개음화 — 굳이[구지], 같이[가치]. 뒤가 ㅇ 또는 ㅎ + ㅣ일 때만.
    if (
      (left.tail === T_D || left.tail === T_T) &&
      (right.lead === L_IEUNG || right.lead === L_H) &&
      right.vowel === V_I
    ) {
      right.lead = left.tail === T_D ? L_J : L_CH;
      left.tail = T_NONE;
      continue;
    }

    // ㅎ 축약 — 받침 ㅎ이 뒤 예사소리를 거세게 만든다. 놓고[노코], 좋다[조타]
    const withoutH = H_CARRIER[left.tail];
    if (withoutH !== undefined) {
      const aspirated = ASPIRATE_AFTER_H[right.lead];
      if (aspirated !== undefined) {
        right.lead = aspirated;
        left.tail = withoutH;
        continue;
      }
    }

    // ㅎ 축약 — 앞 받침이 뒤 ㅎ을 만난다. 입학[이팍], 축하[추카]
    if (right.lead === L_H) {
      const before = ASPIRATE_BEFORE_H[left.tail];
      if (before) {
        right.lead = before[0];
        left.tail = before[1];
        continue;
      }
    }

    if (right.lead !== L_IEUNG) continue;

    // 연음 — 겹받침은 앞것을 남기고 뒷것만 넘긴다. 앉아[안자], 값이[갑씨]
    const link = CLUSTER_LINK[left.tail];
    if (link) {
      left.tail = link[0];
      right.lead = link[1];
      continue;
    }

    // 받침 ㅎ은 넘어가지 않고 사라진다. 좋아[조아]
    if (left.tail === T_H) {
      left.tail = T_NONE;
      continue;
    }

    // 받침 ㅇ은 제자리에 남는다. 강아지[강아지]
    if (left.tail === T_NG) continue;

    const moved = TAIL_TO_LEAD[left.tail];
    if (moved !== undefined) {
      right.lead = moved;
      left.tail = T_NONE;
    }
  }
}

/** 2차 통과 — 남은 겹받침을 대표음으로 줄이고 일곱 종성으로 중화한다. */
function reduceTails(units: readonly Unit[]): void {
  for (const unit of units) {
    if (typeof unit === "string") continue;
    const alone = CLUSTER_ALONE[unit.tail];
    if (alone !== undefined) unit.tail = alone;
    const neutral = NEUTRALIZE[unit.tail];
    if (neutral !== undefined) unit.tail = neutral;
  }
}

/**
 * 3차 통과 — 경음화·비음화·유음화. 순서가 뜻을 가진다.
 *
 * <p>ㄹ→ㄴ을 비음화보다 먼저 해야 백로[뱅노]가 나온다 — ㄹ이 ㄴ이 된 <b>뒤에야</b>
 * 앞 받침 ㄱ이 그 ㄴ 앞에서 ㅇ이 된다.
 */
function assimilate(units: readonly Unit[]): void {
  for (let i = 0; i < units.length - 1; i++) {
    // 반복 범위가 두 자리를 보장한다.
    const left = units[i]!;
    const right = units[i + 1]!;
    if (typeof left === "string" || typeof right === "string") continue;
    if (left.tail === T_NONE) continue;

    // 경음화 — 적금[적끔], 옷장[옫짱]
    if (TENSING_TAILS.has(left.tail)) {
      const tense = TENSE[right.lead];
      if (tense !== undefined) right.lead = tense;
    } else if (left.tail === T_R && TENSE_AFTER_R.has(right.lead)) {
      /*
       * 한자어 규칙이다. 금융 메뉴 어휘는 대부분 한자어라 이득이 크지만 고유어에는
       * 과적용된다. 질의와 라벨이 같은 처리를 받으므로 둘의 대응은 깨지지 않는다.
       */
      right.lead = TENSE[right.lead]!;
    }

    // ㄹ의 비음화 — 종로[종노], 백로[뱅노]
    if (right.lead === L_R && R_TO_N_TAILS.has(left.tail)) {
      right.lead = L_N;
    }

    // 비음화 — 국민[궁민], 학년[항년]
    if (right.lead === L_N || right.lead === L_M) {
      const nasal = NASALIZE[left.tail];
      if (nasal !== undefined) left.tail = nasal;
    }

    // 유음화 — 신라[실라], 칼날[칼랄]
    if (left.tail === T_N && right.lead === L_R) left.tail = T_R;
    else if (left.tail === T_R && right.lead === L_N) right.lead = L_R;
  }
}
