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
    /**
     * 메뉴를 열 때마다 카드를 다시 계산할 것인가. **기본은 끔.**
     *
     * <p>켜면 위 세 가지(마진·쿨다운·지연 커밋) 중 뒤의 둘이 사실상 사라진다. 마진과
     * "한 번에 한 장"은 그대로 살아 있어서 화면이 통째로 뒤집히지는 않지만, 카드가
     * <b>세션 도중에 바뀐다.</b> 기획안 §8.2가 막으려던 바로 그 일이다 — 고령 사용자에게는
     * 화면이 그대로 있는 것이 개인화보다 값지다는 것이 P3의 판단이었다.
     *
     * <p>그럼에도 설정으로 남긴 이유는, "많이 누른 메뉴가 바로 올라오는" 동작을 요구하는
     * 호스트가 실재하고, 그 판단은 호스트의 몫이기 때문이다. 기본값을 바꾸지는 않는다.
     */
    liveReorder: boolean;
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
    /**
     * 이 아래면 후보를 제시하지 않고 되묻는다 (기획안 §8.3 ⑤).
     *
     * <p>0.55에서 0.40으로 내렸다. 실측 근거는 이렇다 — 놓친 19건 중 7건이
     * <b>정답이 이미 1위인데 점수가 0.22~0.47이라 되물은</b> 것이었다. 검색이 틀린 게
     * 아니라 문턱이 높았다. n-gram 의미 매칭은 순서를 맞히지만 절대 점수가 낮다.
     *
     * <p>내린 대가도 함께 쟀다(`pnpm --filter tools tune:threshold`).
     * 정답 60문항과 <b>답이 없어야 하는 20문항</b>을 같은 표에 놓았다.
     * <pre>
     *   0.55  1순위 73%  후보3개 80%  옳게 되물음 100%  잘못된 확신 0건
     *   0.40  1순위 77%  후보3개 85%  옳게 되물음  94%  잘못된 확신 5건
     *   0.30  1순위 82%  후보3개 92%  옳게 되물음  85%  잘못된 확신 12건
     * </pre>
     *
     * <p>0.30이 정확도는 더 높지만 답 없는 질의의 15%에 엉뚱한 메뉴를 자신 있게 내민다.
     * 0.40을 고른 것은 그 지점이 무릎이라고 봤기 때문이고, 근거 있는 판단이지 계산 결과는
     * 아니다. 안전 경계는 이 값과 무관하다 — 자동 실행은 `autoOpenConfidence`(0.9)와
     * `riskLevel`이 따로 막으므로, 이 값이 바꾸는 것은 "되묻기 → 후보 제시"까지다.
     */
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
    /**
     * 의미 유사도에 곱하는 가중치.
     *
     * <p>1.0에서 0.85로 낮췄다. n-gram은 이 파이프라인에서 가장 약한 근거인데
     * <b>가장 큰 점수를 낼 수 있는</b> 항이기도 하다 — 짧은 라벨은 질의에 그 글자가 들어 있기만
     * 하면 코사인 유사도 1.000을 받는다. 그래서 갈래 `자동이체`가 semantic 0.837로
     * 자식 `자동이체내역 조회/해지/변경`의 synonym 0.792를 이기는 일이 생겼다.
     * 사람이 붙인 동의어보다 통계가 앞서는 것은 §8.3이 정한 단계 순서와 어긋난다.
     *
     * <p>튜닝 세트와 검증 세트를 나눠 골랐다(`pnpm --filter tools tune:search`).
     * 효과는 작다 — 검증 세트 30문항 중 1건이다. 표본이 작아 이 수치 자체를 근거로 삼기는
     * 어렵고, 채택한 이유는 <b>방향이 진단과 맞고 잃는 것이 없었기</b> 때문이다
     * (후보 3개 포함과 되묻기는 그대로).
     */
    semanticWeight: number;
    /**
     * 짧은 표현이 긴 질의에 걸렸을 때 남겨 줄 점수의 바닥.
     *
     * <p>점수는 `floor + (1 - floor) × 겹치는 비율`이 곱해진다. 1.0이면 길이를 안 보고,
     * 0에 가까울수록 "질의와 길이가 비슷한 표현"만 인정한다.
     *
     * <p>왜 필요한가. `계좌이체`에는 동의어 "이체"가 붙어 있어서 "이체 한도 늘려줘"라는
     * 질의에 통째로 걸린다. 정작 사용자가 가려던 `이체한도 조회/감액`보다 높은 점수를
     * 받는다 — 두 글자가 일곱 글자 문장 안에 있다는 사실만으로.
     */
    termSpecificityFloor: number;
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
  /**
   * 개인 동의어 학습 (M7).
   *
   * <p>사용자가 쓴 표현을 검색이 못 알아들었는데 결국 그 메뉴로 갔다면, 그 표현은
   * <b>그 사람에게</b> 그 메뉴의 이름이다. 그것을 그 기기에만 적어 둔다.
   *
   * <p>값이 이렇게 잘게 나뉜 이유는, 이 기능이 잘못 배웠을 때의 대가가 크기 때문이다.
   * 잘못 배운 동의어는 사용자를 매번 같은 엉뚱한 곳으로 보낸다. 그래서 <b>언제 배우는지</b>,
   * <b>얼마나 믿는지</b>, <b>언제 잊는지</b>를 전부 호스트가 조절할 수 있게 뒀다.
   */
  learning: {
    /** 끌 수 있다. 학습을 원치 않는 호스트가 실재한다. */
    enabled: boolean;
    /**
     * 배울 표현의 최대 길이(정규화 후).
     *
     * <p>짧게 잡는 것이 안전 장치이기도 하다 — 긴 문장일수록 사람 이름이나 금액이
     * 섞여 들어올 확률이 높고, 정작 <b>다시 똑같이 말할 확률은 낮다.</b>
     */
    maxTermChars: number;
    /** 기기에 남기는 표현의 최대 개수. 넘으면 덜 쓰이고 오래된 것부터 버린다. */
    maxTerms: number;
    /** 이 기간 동안 다시 쓰이지 않은 표현은 잊는다. */
    forgetAfterDays: number;
    /**
     * 한 번 관찰했을 때의 점수. `containmentScore`(0.9)보다 <b>낮게</b> 둔다.
     *
     * <p>한 번의 관찰은 우연일 수 있다. 사용자가 후보 목록을 훑다가 눌러 본 것일 수도 있고,
     * 눌러 보고 아니어서 되돌아 나왔을 수도 있다. 그래서 첫 관찰은 카탈로그에 사람이 붙여 둔
     * 동의어보다 뒤에 세운다 — 후보로는 올라오되 확실한 것을 밀어내지는 못한다.
     */
    baseScore: number;
    /** 관찰이 한 번 늘 때마다 오르는 폭. 반복은 우연이 아니라는 증거다. */
    scoreStep: number;
    /**
     * 상한. 라벨 정확 매칭(1.0)에는 <b>닿지 않는다.</b>
     *
     * <p>사용자가 메뉴 이름을 정확히 말했다면 그것이 언제나 가장 강한 근거다.
     * 학습이 그 위에 서면, 한때 잘못 배운 표현 하나가 이름을 정확히 부른 사람을
     * 계속 엉뚱한 곳으로 보내게 된다.
     */
    maxScore: number;
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
    liveReorder: false,
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
    minConfidence: 0.4,
    maxCandidates: 3,
    minSttConfidence: 0.5,
    containmentScore: 0.9,
    partialScore: 0.8,
    phoneticFloor: 0.75,
    phoneticWeight: 0.95,
    semanticWeight: 0.85,
    termSpecificityFloor: 0.8,
    autoOpenConfidence: 0.9,
  },
  coldStart: {
    visitsUntilPersonalized: 8,
  },
  learning: {
    enabled: true,
    maxTermChars: 20,
    maxTerms: 200,
    forgetAfterDays: 180,
    baseScore: 0.85,
    scoreStep: 0.05,
    maxScore: 0.95,
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
