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

/** 어떤 카드가 왜 그 자리에 있는지 — 디버깅·측정용. */
export interface ScoreBreakdown {
  menuId: MenuId;
  frequency: number;
  recency: number;
  context: number;
  pin: number;
  total: number;
}

// ── 콜드 스타트 ──────────────────────────────────────────────────────────

/** 온보딩 질문 1 — 주로 어떤 일로 앱을 여는가 (기획안 F5). */
export type UsageIntent = "inquiry" | "transfer" | "invest";

/** 온보딩 질문 2 — 글씨 크기. */
export type TextScale = "normal" | "large" | "xlarge";

export interface ColdStartProfile {
  intent: UsageIntent;
  textScale: TextScale;
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
}

/**
 * 이식 계약 ③ (선택). 기본 구현을 쓰지 않을 때만 호스트가 제공한다.
 * 메서드가 두 개뿐인 이유: 계약이 넓어질수록 이식 비용이 오른다.
 */
export interface StorageAdapter {
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
}
