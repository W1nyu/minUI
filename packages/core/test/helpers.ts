import { EventStore } from "../src/EventStore.js";
import { DEFAULT_CONFIG, type MinUIConfig } from "../src/config.js";
import type { LayoutState, MenuCatalog, MenuId, ScoreBreakdown } from "../src/types.js";

/** 테스트 기준 시각: 2026-01-15(목) 10:00 KST. */
export const T0 = Date.UTC(2026, 0, 15, 1, 0, 0);

/** 데모 은행 앱 카탈로그의 축소판. 실제 25개 메뉴는 frontend에 있다. */
export const CATALOG: MenuCatalog = [
  {
    id: "inquiry.balance",
    label: "잔액 보기",
    category: "조회",
    icon: "wallet",
    route: "/inquiry/balance",
    riskLevel: "low",
  },
  {
    id: "transfer.account",
    label: "계좌 이체",
    category: "이체",
    icon: "transfer",
    route: "/transfer/account",
    riskLevel: "high",
  },
  {
    id: "inquiry.history",
    label: "거래 내역",
    category: "조회",
    icon: "list",
    route: "/inquiry/history",
    riskLevel: "low",
  },
  {
    id: "transfer.auto",
    label: "자동이체 관리",
    category: "이체",
    icon: "repeat",
    route: "/transfer/auto",
    riskLevel: "high",
  },
  {
    id: "settings.limit",
    label: "한도 변경",
    category: "설정",
    icon: "gauge",
    route: "/settings/limit",
    riskLevel: "high",
  },
  {
    id: "product.loan",
    label: "대출 상품",
    category: "상품",
    icon: "bank",
    route: "/product/loan",
    riskLevel: "low",
  },
  {
    id: "market.quote",
    label: "실시간 시세",
    category: "조회",
    icon: "chart",
    route: "/market/quote",
    riskLevel: "low",
    // 실시간 화면은 카드로 고정하기에 맞지 않는다 (기획안 §15)
    cardable: false,
  },
];

/** 완료까지 이어진 사용 1건. */
export function useMenu(store: EventStore, menuId: MenuId, at: number): void {
  store.record({ type: "menu_enter", menuId }, at);
  store.record({ type: "task_complete", menuId }, at + 30_000);
}

/** 들어갔다 그냥 나온 사용 1건. */
export function bounceMenu(store: EventStore, menuId: MenuId, at: number): void {
  store.record({ type: "menu_enter", menuId }, at);
}

export function makeStore(config: MinUIConfig = DEFAULT_CONFIG): EventStore {
  return new EventStore(config);
}

/**
 * 점수만 지정해 랭킹 결과를 만든다. LayoutStabilizer 테스트는 점수가 *어떻게*
 * 나왔는지와 무관해야 하므로 RankingEngine을 거치지 않는다.
 */
export function rankedList(entries: readonly [MenuId, number][]): ScoreBreakdown[] {
  return entries
    .map(([menuId, total]) => ({
      menuId,
      frequency: total,
      recency: 0,
      context: 0,
      pin: 0,
      total,
    }))
    .sort((a, b) => b.total - a.total);
}

export function emptyLayout(): LayoutState {
  return { current: [], pending: null, lastRecomputedAt: 0, introducedAt: {} };
}
