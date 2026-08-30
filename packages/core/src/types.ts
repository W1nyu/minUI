/**
 * MinUI Engine 공개 타입.
 *
 * 여기 있는 것은 전부 호스트 앱과 주고받는 계약이거나, 저장소에 직렬화되는 데이터다.
 * 함수 타입(ActionHandler, Clock, StorageAdapter)을 제외한 모든 구조는
 * JSON으로 왕복 가능해야 한다 — 다른 언어로 포팅할 때 그대로 재사용하기 위해서다.
 */

export type MenuId = string;

/** 오인식·오조작의 대가가 큰 메뉴일수록 높다. `high`는 음성 자동 실행 금지 (기획안 §9.3). */
export type RiskLevel = "low" | "medium" | "high";

/** 호스트 앱이 제공하는 메뉴 하나. 이식 계약 ① (기획안 §7.2). */
export interface MenuItem {
  id: MenuId;
  label: string;
  /** 구어 표현. 검색 파이프라인의 정확 매칭 단계에서 최우선으로 쓰인다. */
  synonyms?: string[];
  category: string;
  /**
   * 이 메뉴에 이르는 상위 메뉴 이름들. 최상위부터, 자기 자신은 뺀다.
   *
   * <p>엔진은 이 값을 <b>랭킹에도 검색에도 쓰지 않는다.</b> 호스트가 목록을
   * "상위메뉴 - 하위메뉴"로 묶어 보여 줄 때만 쓰는 표시용 정보다. 메뉴가 수백 개인
   * 실제 금융사에서는 `펀드검색`이라는 이름만으로는 그것이 어디에 속한 것인지
   * 알 수 없어, 검색 결과가 평평한 목록이면 다시 탐색 문제가 된다.
   *
   * <p>계층이 없는 호스트는 생략한다.
   */
  path?: readonly string[];
  /**
   * 이 메뉴가 무엇인지 한 줄로. 어려운 금융 용어를 풀어 준다.
   *
   * <p>기획안 §15가 지목한 증권 앱의 실제 장벽이다 — `예수금`·`미수`·`반대매매`는
   * 메뉴를 <b>찾는 것</b>과 별개로 <b>그게 뭔지 아는 것</b>이 막힌다. 랭킹과 검색은
   * 이 값을 쓰지 않는다. 순전히 보여 주는 정보이며, 없는 호스트는 생략한다.
   */
  hint?: string;
  icon: string;
  route: string;
  riskLevel: RiskLevel;
  /**
   * 카드 홈에 올릴 수 있는 메뉴인가. 기본 true.
   * 실시간 시세처럼 카드화가 맞지 않는 화면을 호스트가 제외할 수 있다 (기획안 §15).
   */
  cardable?: boolean;
}

export type MenuCatalog = readonly MenuItem[];

/** 메뉴 ID를 받아 호스트 앱 화면을 여는 함수. 이식 계약 ② (기획안 §7.2). */
export type ActionHandler = (
  menuId: MenuId,
  params?: Record<string, unknown>,
) => void;

/**
 * 발화에서 뽑아 화면에 미리 채울 값 (M9). 호스트가 정의한다.
 *
 * <p>엔진은 이 안에 무엇이 들었는지 <b>모른다.</b> 수취인인지 기간인지 계좌 별명인지는
 * 금융 도메인이고, 도메인이 엔진에 들어오면 이식성이 사라진다 (기획안 §7.2).
 * 엔진이 지키는 것은 이 값이 §9.3의 안전 경계를 넘지 않는다는 것 하나다.
 */
export type Slots = Readonly<Record<string, unknown>>;

/**
 * 발화와 열릴 메뉴를 받아 미리 채울 값을 만든다. 이식 계약 ④ (선택).
 *
 * <p>`@minui/core`의 `parseAmount`·`pickFromList`가 한국어를 읽는 부분을 도와주지만,
 * <b>무엇을 채울지는 호스트가 정한다.</b> 수취인 목록도 계좌 별명도 호스트만 안다.
 */
export type SlotExtractor = (query: string, menuId: MenuId) => Slots;

/** 현재 시각(epoch ms). 엔진은 절대 `Date.now()`를 직접 부르지 않는다. */
export type Clock = () => number;

// ── 사용 이력 ────────────────────────────────────────────────────────────

export type UsageEventType = "menu_enter" | "task_complete";

export interface UsageEvent {
  type: UsageEventType;
  menuId: MenuId;
  /** 생략하면 엔진의 Clock을 쓴다. */
  at?: number;
}

/**
 * 저장되는 단위. 기획안 §11.1이 허용한 세 필드가 전부다.
 * 금액·계좌번호·수취인은 여기에 들어올 자리가 없다.
 */
export interface Visit {
  menuId: MenuId;
  at: number;
  /** 이 진입이 작업 완료까지 이어졌는가. 들어갔다 바로 나온 방문과 구분한다. */
  completed: boolean;
}

/**
 * 이 기기의 사용자가 실제로 쓴 표현 하나 (M7).
 *
 * <p>§11.1이 저장을 허용한 범위를 넘는 유일한 구조다. 넘는 대신 좁혔다 — 여기 오는 것은
 * 사용자가 <b>스스로 검색창에 넣은</b> 짧은 표현이고, <b>숫자가 없다</b>(금액·계좌번호 차단).
 * 그리고 기기를 떠나지 않는다. 판단과 근거는 `search/LearnedTerms.ts`에 적어 뒀다.
 */
export interface LearnedTerm {
  /** 정규화된 표현. 사용자가 친 문장 원본이 아니다. */
  term: string;
  menuId: MenuId;
  /** 같은 짝이 관찰된 횟수. 얼마나 믿을지가 여기서 나온다. */
  count: number;
  /** 마지막으로 관찰된 시각. 잊을지 판단하는 기준. */
  lastAt: number;
}

/** 보존 기간이 지난 방문을 대체하는 집계 카운터 (기획안 F1). */
export interface VisitAggregate {
  completed: number;
  incomplete: number;
  /** 집계에 흡수된 방문 중 가장 최근 시각. 최신성 항이 0으로 죽지 않게 한다. */
  lastAt: number;
}

// ── 카드 ─────────────────────────────────────────────────────────────────

export interface RankedCard {
  menuId: MenuId;
  score: number;
  pinned: boolean;
  /** 최근 교체로 새로 들어온 카드. UI가 "새로 추가됨" 배지를 붙인다. */
  isNew: boolean;
}

/**
 * 이 카드가 왜 홈에 있는가 (M8) — **사용자에게 보여 줄 이유.**
 *
 * <p>`ScoreBreakdown`과 목적이 다르다. 그쪽은 개발자가 랭킹을 디버깅하려고 보는 점수이고,
 * 이쪽은 사용자가 "왜 화면이 이렇게 됐지"라고 물었을 때의 답이다. 점수를 그대로 보여 주는
 * 것은 답이 아니다 — <b>"1.79점이라 여기 있어요"는 설명이 아니다.</b>
 *
 * <p>문구는 담지 않는다. 판단은 엔진이 하고 말은 호스트가 고른다 — 한국어 문장이 core에
 * 들어오면 다른 언어로 포팅할 때 함께 끌려온다.
 */
export type CardReason =
  /** 사용자가 직접 고정했다. 자동 판단보다 위다 */
  | { kind: "pinned" }
  /** 실제로 써서 올라왔다 */
  | { kind: "used"; views: number; lastUsedAt: number }
  /** 아직 기록이 없어 처음 자리 그대로다 */
  | { kind: "preset" };

export interface CardExplanation {
  menuId: MenuId;
  reason: CardReason;
  /**
   * 최근 교체로 새로 들어왔는가 (F3의 변경 고지).
   *
   * <p>이유와 <b>따로</b> 둔다. 합쳐 두면 배지가 만료된 뒤 이유까지 사라진다 —
   * "새로 왔다"는 한때의 사실이고 "왜 여기 있다"는 지금의 사실이다.
   */
  isNew: boolean;
}

/** 어떤 카드가 왜 그 자리에 있는지 — 디버깅·측정용. */
export interface ScoreBreakdown {
  menuId: MenuId;
  frequency: number;
  recency: number;
  context: number;
  pin: number;
  total: number;
  /**
   * 조회 횟수 원본. `frequency`와 다르다 — 그쪽은 로그를 씌우고 미완료 방문에
   * 낮은 가중치를 준 <b>점수</b>이고, 이것은 사람이 세는 것과 같은 <b>횟수</b>다.
   *
   * <p>카드 순서를 "조회 횟수가 많은 것부터"로 정하려면 점수가 아니라 횟수가 필요하다.
   * 로그를 씌운 값으로 비교하면 5회와 6회의 차이가 0.15밖에 안 되어, 최신성 항이
   * 그것을 뒤집는다 — 사용자가 보기에는 덜 쓴 메뉴가 위에 있는 상태가 된다.
   */
  views: number;
  /** 마지막으로 연 시각. 횟수가 같을 때의 순서를 정한다. 쓴 적이 없으면 null. */
  lastUsedAt: number | null;
}

// ── 콜드 스타트 ──────────────────────────────────────────────────────────

/** 온보딩 질문 1 — 주로 어떤 일로 앱을 여는가 (기획안 F5). */
export type UsageIntent = "inquiry" | "transfer" | "invest";

/** 온보딩 질문 2 — 글씨 크기. */
export type TextScale = "normal" | "large" | "xlarge";

/**
 * 화면 대비 (F17). 색만 바꾸고 배치는 건드리지 않는다.
 *
 * <p>글씨 크기와 <b>다른 축</b>이다. 크게 해도 안 보이는 사람과 크기는 괜찮은데 흐린
 * 색을 못 읽는 사람은 서로 다른 사람이고, 한 손잡이로 묶으면 둘 중 하나는 필요 없는
 * 것까지 받는다.
 */
export type Contrast = "normal" | "high";

export interface ColdStartProfile {
  intent: UsageIntent;
  textScale: TextScale;
  /**
   * **선택 필드다.** 없으면 `"normal"`로 읽는다.
   *
   * <p>필수로 만들면 `STATE_VERSION`을 올려야 하고, 그러면 이미 쓰던 사람의 카드 배치와
   * 배운 말이 마이그레이션 대상이 된다. 대비 하나를 더하자고 치를 값이 아니다 —
   * 온보딩을 봤는지를 엔진 상태가 아니라 localStorage에 둔 것과 같은 판단
   * (`MinUIShell`).
   */
  contrast?: Contrast;
}

/** 의도별 초기 카드 세트. 호스트 앱이 자기 메뉴 ID로 채운다. */
export type ColdStartPresets = Readonly<Record<UsageIntent, readonly MenuId[]>>;

// ── 배치 상태 ────────────────────────────────────────────────────────────

export interface LayoutState {
  /** 지금 화면에 보이는 카드 구성. 세션 도중에는 절대 바뀌지 않는다. */
  current: MenuId[];
  /** 재배치가 확정됐지만 아직 반영되지 않은 구성. 다음 세션 시작 때 current가 된다. */
  pending: MenuId[] | null;
  /** 마지막으로 재배치가 *확정*된 시각. 쿨다운 계산 기준. */
  lastRecomputedAt: number;
  /** 카드가 새로 들어온 시각. 배지 만료 판단에 쓴다. */
  introducedAt: Record<MenuId, number>;
}

// ── 저장 ─────────────────────────────────────────────────────────────────

export interface PersistedState {
  version: number;
  visits: Visit[];
  aggregates: Record<MenuId, VisitAggregate>;
  pinned: MenuId[];
  layout: LayoutState;
  profile: ColdStartProfile | null;
  /** 엔진 초기화 횟수. 콜드 스타트 프리셋에서 개인화로 넘어가는 판단에 쓴다. */
  sessionCount: number;
  /**
   * 이 기기가 배운 표현들 (M7). 없으면 빈 목록으로 읽는다 —
   * M7 이전에 저장된 상태도 그대로 열려야 한다.
   */
  learned?: LearnedTerm[];
}

/**
 * 이식 계약 ③ (선택). 기본 구현을 쓰지 않을 때만 호스트가 제공한다.
 * 메서드가 두 개뿐인 이유: 계약이 넓어질수록 이식 비용이 오른다.
 */
export interface StorageAdapter {
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
}
