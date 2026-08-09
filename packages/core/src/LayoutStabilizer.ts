import type { MinUIConfig } from "./config.js";
import type { LayoutState, MenuId, RankedCard, ScoreBreakdown } from "./types.js";

export interface Swap {
  out: MenuId;
  in: MenuId;
}

export interface RecomputeResult {
  state: LayoutState;
  /** 화면(current)이 이번 호출로 바로 바뀌었는가. */
  appliedNow: boolean;
  /** 다음 세션에 반영될 구성이 새로 생겼는가. */
  deferred: boolean;
  swaps: Swap[];
}

export interface RecomputeOptions {
  /** 사용자가 직접 일으킨 변경(핀 등). 쿨다운을 무시하고 즉시 반영한다. */
  force?: boolean;
}

/**
 * 배치 안정화 (기획안 F3 / §8.2). **이 프로젝트에서 가장 중요한 부분이다.**
 *
 * 랭킹만 있으면 화면이 매일 흔들린다. 고령 사용자에게는 그것이 개인화의 이득보다 크게 해롭다
 * (원칙 P3). 그래서 여기서 네 가지를 강제한다.
 *
 *   ① 20% 마진 — 근소한 점수 차로 순서가 뒤집히지 않는다
 *   ② 24시간 쿨다운 — 재배치 자체가 자주 일어나지 않는다
 *   ③ 1회 1장 — 한 번에 화면 전체가 바뀌지 않는다
 *   ④ 지연 커밋 — 확정된 교체도 다음 세션에야 보인다
 *
 * 여기에 더해, **자리를 지킨다.** 랭킹 순서가 바뀌어도 남아 있는 카드는 움직이지 않고,
 * 교체가 일어나면 새 카드가 나간 카드의 자리에 들어간다. 점수 순으로 매번 재정렬하면
 * 교체가 없어도 화면이 흔들려 ①~④가 무의미해진다.
 *
 * 예외는 두 가지다. 둘 다 "가만히 두는 쪽이 더 나쁜" 경우다.
 *   - 호스트 카탈로그에서 사라진 메뉴: 누르면 깨지므로 즉시 제거
 *   - 사용자가 직접 일으킨 변경(force): 탈출구가 24시간 뒤에 열리면 탈출구가 아니다
 */
export class LayoutStabilizer {
  readonly #config: MinUIConfig;

  constructor(config: MinUIConfig) {
    this.#config = config;
  }

  /**
   * 세션 시작. 확정 대기 중이던 구성을 화면에 올린다.
   * 이 순간이 카드가 바뀌는 유일한 시점이다(즉시 반영 예외 제외).
   */
  startSession(state: LayoutState, now: number): LayoutState {
    if (!state.pending) return state;

    const introducedAt = { ...state.introducedAt };
    for (const menuId of state.pending) {
      if (!state.current.includes(menuId)) introducedAt[menuId] = now;
    }

    return {
      current: [...state.pending],
      pending: null,
      lastRecomputedAt: state.lastRecomputedAt,
      introducedAt,
    };
  }

  recompute(
    state: LayoutState,
    ranked: readonly ScoreBreakdown[],
    now: number,
    options: RecomputeOptions = {},
  ): RecomputeResult {
    const cardCount = Math.min(this.#config.cards.count, this.#config.cards.max);
    const scores = new Map(ranked.map((r) => [r.menuId, r.total]));
    const rankOrder = ranked.map((r) => r.menuId);

    // ── 최초 배치: 지킬 것이 없으므로 히스테리시스가 개입하지 않는다.
    if (state.current.length === 0) {
      const initial = rankOrder.slice(0, cardCount);
      return {
        // 첫 화면은 전부 새것이다. 전부에 배지를 달면 배지가 정보를 잃으므로
        // introducedAt을 기록하지 않는다.
        //
        // 쿨다운 시계는 여기서 시작한다. 그러지 않으면 설치 첫날부터 카드가 흔들린다.
        state: { ...state, current: initial, pending: null, lastRecomputedAt: now },
        appliedNow: initial.length > 0,
        deferred: false,
        swaps: [],
      };
    }

    // ── 1단계(즉시): 사라진 메뉴를 비우고 빈 자리를 채운다.
    const slots: (MenuId | null)[] = state.current
      .slice(0, cardCount)
      .map((id) => (scores.has(id) ? id : null));
    while (slots.length < cardCount) slots.push(null);

    const bench = rankOrder.filter((id) => !slots.includes(id));
    let structuralChange = slots.length !== state.current.length;

    for (let i = 0; i < slots.length; i++) {
      if (slots[i] !== null) continue;
      const filler = bench.shift();
      if (filler === undefined) continue;
      slots[i] = filler;
      structuralChange = true;
    }

    // ── 2단계(원칙적으로 지연): 마진을 넘는 도전자만 자리를 빼앗는다.
    const swaps: Swap[] = [];
    const cooledDown =
      now - state.lastRecomputedAt >= this.#config.stability.recomputeCooldownMs;

    if (options.force === true || cooledDown) {
      let budget = this.#config.stability.maxSwapsPerRecompute;

      while (budget > 0 && bench.length > 0) {
        const challenger = bench[0]!;
        const weakest = this.#weakestSlot(slots, scores);
        if (weakest === null) break;

        const incumbentScore = scores.get(slots[weakest]!) ?? 0;
        const challengerScore = scores.get(challenger) ?? 0;

        if (
          challengerScore <=
          incumbentScore * this.#config.stability.challengerMarginRatio
        ) {
          break; // 최강 도전자도 마진을 못 넘으면 그 뒤는 볼 것도 없다
        }

        swaps.push({ out: slots[weakest]!, in: challenger });
        slots[weakest] = challenger;
        bench.shift();
        budget -= 1;
      }
    }

    const next = slots.filter((id): id is MenuId => id !== null);
    const applyImmediately = options.force === true || structuralChange;

    if (swaps.length === 0 && !structuralChange) {
      // 아무 일도 없었다. 쿨다운 타이머를 다시 시작시키지 않는 것이 중요하다 —
      // 그러지 않으면 실패한 시도가 다음 24시간을 잡아먹는다.
      return { state, appliedNow: false, deferred: false, swaps: [] };
    }

    const lastRecomputedAt = swaps.length > 0 ? now : state.lastRecomputedAt;

    if (applyImmediately) {
      const introducedAt = { ...state.introducedAt };
      for (const menuId of next) {
        if (!state.current.includes(menuId)) introducedAt[menuId] = now;
      }
      return {
        // 화면이 즉시 바뀌었으므로, 옛 화면 기준으로 계산된 pending은 무효다.
        state: { current: next, pending: null, lastRecomputedAt, introducedAt },
        appliedNow: true,
        deferred: false,
        swaps,
      };
    }

    return {
      state: { ...state, pending: next, lastRecomputedAt },
      appliedNow: false,
      deferred: true,
      swaps,
    };
  }

  /** 화면에 보이는 카드. 순서는 배치 그대로이며 점수로 다시 정렬하지 않는다. */
  cards(
    state: LayoutState,
    ranked: readonly ScoreBreakdown[],
    pinned: readonly MenuId[],
    now: number,
  ): RankedCard[] {
    const scores = new Map(ranked.map((r) => [r.menuId, r.total]));
    const pins = new Set(pinned);
    const badgeWindow = this.#config.stability.newBadgeDurationMs;

    return state.current.map((menuId) => {
      const introducedAt = state.introducedAt[menuId];
      return {
        menuId,
        score: scores.get(menuId) ?? 0,
        pinned: pins.has(menuId),
        isNew: introducedAt !== undefined && now - introducedAt < badgeWindow,
      };
    });
  }

  #weakestSlot(
    slots: readonly (MenuId | null)[],
    scores: ReadonlyMap<MenuId, number>,
  ): number | null {
    let weakest: number | null = null;
    let weakestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < slots.length; i++) {
      const id = slots[i];
      if (id === null || id === undefined) continue;
      const score = scores.get(id) ?? 0;
      // 동점이면 뒤쪽 자리를 내보낸다(`<=`). 콜드 스타트 직후처럼 현직이 전부 0점인
      // 상황에서 첫 자리를 먼저 비우면, 온보딩으로 정한 가장 중요한 카드가 제일 먼저
      // 사라진다. 뒤쪽 자리가 곧 우선순위가 낮은 자리다.
      if (score <= weakestScore) {
        weakestScore = score;
        weakest = i;
      }
    }
    return weakest;
  }
}
