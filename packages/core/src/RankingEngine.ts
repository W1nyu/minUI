import type { EventStore } from "./EventStore.js";
import { DAY_MS, type MinUIConfig } from "./config.js";
import { contextBoost } from "./contextBoost.js";
import type { MenuCatalog, MenuId, ScoreBreakdown } from "./types.js";

export interface RankOptions {
  catalog: MenuCatalog;
  now: number;
  pinned?: readonly MenuId[];
}

/**
 * 개인화 랭킹 (기획안 F2 / §8.1).
 *
 *   score(m) = w_f·log(1+freq) + w_r·exp(-λ·Δt) + w_c·contextBoost + w_p·isPinned
 *
 * 이 클래스는 "무엇이 위인가"만 답한다. "화면을 언제 바꿀 것인가"는
 * LayoutStabilizer의 몫이다 — 둘을 섞으면 원칙 P3(예측 가능성)을 테스트할 수 없다.
 */
export class RankingEngine {
  readonly #config: MinUIConfig;
  readonly #events: EventStore;

  constructor(config: MinUIConfig, events: EventStore) {
    this.#config = config;
    this.#events = events;
  }

  /** 카드 후보 전체를 점수 내림차순으로. 동점은 카탈로그 순서를 따른다. */
  scoreAll(options: RankOptions): ScoreBreakdown[] {
    const pinned = new Set(options.pinned ?? []);
    const candidates = options.catalog.filter((m) => m.cardable !== false);

    const scored = candidates.map((menu, index) => ({
      index,
      breakdown: this.#score(menu.id, options.now, pinned.has(menu.id)),
    }));

    scored.sort((a, b) => {
      const diff = b.breakdown.total - a.breakdown.total;
      // 동점일 때 카탈로그 순서로 고정한다. 부동소수 오차로 순서가 흔들리면
      // 사용자에게는 "이유 없이 화면이 바뀐" 것으로 보인다.
      return diff !== 0 ? diff : a.index - b.index;
    });

    return scored.map((s) => s.breakdown);
  }

  /** 홈에 올릴 카드 ID. 설정된 카드 수와 최대치 중 작은 쪽을 따른다. */
  topN(options: RankOptions, count?: number): MenuId[] {
    const n = Math.min(count ?? this.#config.cards.count, this.#config.cards.max);
    return this.scoreAll(options)
      .slice(0, n)
      .map((r) => r.menuId);
  }

  score(menuId: MenuId, now: number, isPinned = false): ScoreBreakdown {
    return this.#score(menuId, now, isPinned);
  }

  #score(menuId: MenuId, now: number, isPinned: boolean): ScoreBreakdown {
    const w = this.#config.ranking.weights;

    // 빈도 — 로그를 씌워 다빈도 메뉴의 독점을 막는다.
    // 하루 20번 쓴 메뉴가 20배 점수를 갖지 않게 하려는 것 (기획안 §8.1).
    const freq = this.#events.weightedFrequency(menuId);
    const frequency = w.frequency * Math.log(1 + freq);

    // 최신성 — 마지막 사용으로부터 지수 감쇠. 쓴 적이 없으면 0.
    const lastAt = this.#events.lastUsedAt(menuId);
    const recency =
      lastAt === null
        ? 0
        : w.recency *
          Math.exp(
            -this.#config.ranking.recencyDecayPerDay *
              Math.max(0, (now - lastAt) / DAY_MS),
          );

    // 상황 — 원본이 남아 있는 방문만으로 판단한다.
    // 집계로 접힌 오래된 기록은 개별 시각이 없어 주기성을 말할 수 없다.
    const context =
      w.context * contextBoost(this.#events.visitsOf(menuId), now, this.#config);

    const pin = isPinned ? w.pin : 0;

    return {
      menuId,
      frequency,
      recency,
      context,
      pin,
      total: frequency + recency + context + pin,
    };
  }
}
