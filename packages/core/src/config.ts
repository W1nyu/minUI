/**
 * 튜닝 가능한 값은 전부 여기 모인다. 코드에 상수를 박지 않는 이유는 두 가지다.
 *  ① 기획안 §8.2가 "이 값들은 초기 가설이며 M5에서 조정 대상"이라고 명시했다.
 *  ② 다른 언어로 포팅할 때 설정 JSON과 테스트 픽스처가 그대로 넘어가야 한다.
 *
 * 따라서 이 인터페이스에는 함수·클래스·Date가 들어올 수 없다. 순수 데이터만.
 */

export interface RankingWeights {
  /** w_f — 빈도 */
  frequency: number;
  /** w_r — 최신성 */
  recency: number;
  /** w_c — 상황 */
  context: number;
  /** w_p — 고정. 사실상 무한대 역할 */
  pin: number;
}

export interface ContextWeights {
  /** 매달 비슷한 날짜에 쓰는 패턴 (예: 25일 관리비) */
  monthly: number;
  /** 특정 요일에 쓰는 패턴 */
  weekday: number;
  /** 특정 시간대에 쓰는 패턴 */
  hourOfDay: number;
}

export interface MinUIConfig {
  cards: {
    /** 홈에 기본 노출할 카드 수 */
    count: number;
    /** 최대치. 스크롤이 생기면 원칙 P1이 깨진다 */
    max: number;
  };
  ranking: {
    weights: RankingWeights;
    /** λ — 하루당 감쇠 계수. 0.05면 반감기 약 14일 */
    recencyDecayPerDay: number;
    /**
     * 작업 완료 없이 이탈한 방문의 가중치.
     * 잘못 들어간 메뉴가 카드로 올라오면 안 된다 (기획안 F1).
     */
    incompleteVisitWeight: number;
  };
  stability: {
    /** 도전자가 현재 카드를 밀어내는 데 필요한 점수 배율 (1.20 = 20% 마진) */
    challengerMarginRatio: number;
    /** 재배치 사이 최소 간격 */
    recomputeCooldownMs: number;
    /** 한 번의 재배치에서 교체 가능한 카드 수 */
    maxSwapsPerRecompute: number;
    /** "새로 추가됨" 배지 유지 기간 */
    newBadgeDurationMs: number;
  };
  retention: {
    /** 원본 방문 기록 보존 일수. 초과분은 집계 카운터로 접힌다 */
    rawVisitWindowDays: number;
    /** menu_enter와 task_complete를 같은 방문으로 묶는 최대 간격 */
    visitPairingWindowMs: number;
  };
  context: {
    /** 월 주기 판단 허용 오차(일) */
    monthlyDayTolerance: number;
    /** 시간대 일치 허용 오차(시간) */
    hourTolerance: number;
    weights: ContextWeights;
    /** 이 횟수 미만이면 주기성을 주장하지 않는다 — 우연을 패턴으로 오인하지 않기 위해 */
    minObservations: number;
    /**
     * "25일", "목요일 오전" 같은 판단은 사용자의 달력 기준이어야 한다.
     * core는 시스템 타임존을 읽지 않으므로(그것도 호스트 환경 의존이다) 오프셋을 설정으로 받는다.
     * 브라우저 바인딩은 `-new Date().getTimezoneOffset()` 값으로 덮어쓴다.
     */
    utcOffsetMinutes: number;
  };
  search: {
    /** 이 아래면 후보를 제시하지 않고 되묻는다 (기획안 §8.3 ⑤) */
    minConfidence: number;
    maxCandidates: number;
    /** STT 신뢰도가 이 아래면 검색조차 하지 않는다 (기획안 §9.2) */
    minSttConfidence: number;
    /** 동의어가 질의 안에 통째로 들어 있을 때의 점수 */
    containmentScore: number;
    /** 질의가 동의어의 일부일 때(앞부분만 말한 경우)의 점수 */
    partialScore: number;
    /** 자모 보정이 개입하는 하한. 이 아래는 "오인식 복구"가 아니라 우연이다 */
    phoneticFloor: number;
    /** 자모 유사도에 곱하는 가중치 */
    phoneticWeight: number;
    /** 의미 유사도에 곱하는 가중치 */
    semanticWeight: number;
    /**
     * 후보가 하나뿐이고 위험하지 않을 때, 확인 없이 화면을 열어도 되는 확신 수준.
     * 조회성 화면이 잘못 열리는 비용은 낮지만, 그래도 애매하면 물어보는 편이 낫다.
     */
    autoOpenConfidence: number;
  };
  coldStart: {
    /** 프리셋에서 실제 사용 기록 기반 랭킹으로 넘어가는 방문 수 */
    visitsUntilPersonalized: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_CONFIG: MinUIConfig = {
  cards: { count: 4, max: 6 },
  ranking: {
    weights: { frequency: 1.0, recency: 0.6, context: 0.4, pin: 100 },
    recencyDecayPerDay: 0.05,
    incompleteVisitWeight: 0.25,
  },
  stability: {
    challengerMarginRatio: 1.2,
    recomputeCooldownMs: DAY_MS,
    maxSwapsPerRecompute: 1,
    newBadgeDurationMs: 3 * DAY_MS,
  },
  retention: {
    rawVisitWindowDays: 90,
    visitPairingWindowMs: 10 * 60 * 1000,
  },
  context: {
    monthlyDayTolerance: 3,
    hourTolerance: 2,
    weights: { monthly: 1.0, weekday: 0.5, hourOfDay: 0.3 },
    minObservations: 3,
    utcOffsetMinutes: 540, // KST. 데모 대상이 국내 금융 앱이라 이 값을 기본으로 둔다.
  },
  search: {
    minConfidence: 0.55,
    maxCandidates: 3,
    minSttConfidence: 0.5,
    containmentScore: 0.9,
    partialScore: 0.8,
    phoneticFloor: 0.75,
    phoneticWeight: 0.95,
    semanticWeight: 1.0,
    autoOpenConfidence: 0.9,
  },
  coldStart: {
    visitsUntilPersonalized: 8,
  },
};

/** 호스트가 일부만 덮어쓸 수 있게 하는 부분 설정. */
export type PartialConfig = {
  [K in keyof MinUIConfig]?: DeepPartial<MinUIConfig[K]>;
};

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 깊은 병합. `ranking.weights.frequency` 하나만 바꾸려다 나머지 가중치가
 * 통째로 사라지는 일을 막는다 — 튜닝 중 가장 흔한 실수 지점이다.
 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = deepMerge(out[key], value);
  }
  return out as T;
}

export function resolveConfig(overrides?: PartialConfig): MinUIConfig {
  if (!overrides) return DEFAULT_CONFIG;
  return deepMerge(DEFAULT_CONFIG, overrides);
}

export { DAY_MS };
