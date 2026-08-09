import type { MinUIConfig } from "./config.js";
import { DAY_MS } from "./config.js";
import type { MenuId, UsageEvent, Visit, VisitAggregate } from "./types.js";

export interface EventStoreSnapshot {
  visits: Visit[];
  aggregates: Record<MenuId, VisitAggregate>;
}

/**
 * 사용 이력 저장소 (기획안 F1).
 *
 * 기록하는 것은 `{메뉴ID, 시각, 완료여부}` 세 필드뿐이다.
 * 금액·계좌번호·수취인이 들어올 자리를 애초에 만들지 않았다.
 */
export class EventStore {
  readonly #config: MinUIConfig;
  #visits: Visit[];
  #aggregates: Record<MenuId, VisitAggregate>;

  constructor(config: MinUIConfig, snapshot?: EventStoreSnapshot) {
    this.#config = config;
    this.#visits = snapshot ? [...snapshot.visits] : [];
    this.#aggregates = snapshot ? { ...snapshot.aggregates } : {};
  }

  record(event: UsageEvent, now: number): void {
    const at = event.at ?? now;

    if (event.type === "menu_enter") {
      this.#insert({ menuId: event.menuId, at, completed: false });
      return;
    }

    // task_complete: 아직 완료 표시가 안 된 같은 메뉴의 최근 진입을 찾아 완료로 바꾼다.
    // 못 찾으면(호스트가 진입 이벤트를 안 보냈거나 너무 오래됐으면) 독립 방문으로 받는다.
    const paired = this.#findPairableVisit(event.menuId, at);
    if (paired) {
      paired.completed = true;
      return;
    }
    this.#insert({ menuId: event.menuId, at, completed: true });
  }

  /** 시각 오름차순을 유지한 채 삽입. 호스트가 과거 이벤트를 늦게 보낼 수 있다. */
  #insert(visit: Visit): void {
    const last = this.#visits[this.#visits.length - 1];
    if (!last || last.at <= visit.at) {
      this.#visits.push(visit);
      return;
    }
    const idx = this.#visits.findIndex((v) => v.at > visit.at);
    this.#visits.splice(idx, 0, visit);
  }

  #findPairableVisit(menuId: MenuId, at: number): Visit | undefined {
    const pairingWindow = this.#config.retention.visitPairingWindowMs;
    for (let i = this.#visits.length - 1; i >= 0; i--) {
      const v = this.#visits[i];
      if (!v) continue;
      if (at - v.at > pairingWindow) break; // 시각 오름차순이므로 더 볼 것도 없다
      if (v.menuId === menuId && !v.completed) return v;
    }
    return undefined;
  }

  /**
   * 보존 기간을 넘긴 원본 방문을 지우고 집계 카운터로 접는다.
   * 빈도는 보존되고 개별 시각만 사라진다 — 저장량과 프라이버시를 함께 줄이는 지점.
   */
  rollup(now: number): void {
    const cutoff = now - this.#config.retention.rawVisitWindowDays * DAY_MS;
    if (this.#visits.length === 0 || (this.#visits[0]?.at ?? now) >= cutoff) return;

    const kept: Visit[] = [];
    for (const visit of this.#visits) {
      if (visit.at >= cutoff) {
        kept.push(visit);
        continue;
      }
      const agg = (this.#aggregates[visit.menuId] ??= {
        completed: 0,
        incomplete: 0,
        lastAt: visit.at,
      });
      if (visit.completed) agg.completed += 1;
      else agg.incomplete += 1;
      agg.lastAt = Math.max(agg.lastAt, visit.at);
    }
    this.#visits = kept;
  }

  /**
   * 빈도 항의 입력값. 완료된 방문은 1, 완료 없이 이탈한 방문은 낮은 가중치로 센다.
   * 잘못 들어갔다 나온 메뉴가 카드로 올라오는 것을 막는 장치다.
   */
  weightedFrequency(menuId: MenuId): number {
    const w = this.#config.ranking.incompleteVisitWeight;
    let total = 0;

    for (const visit of this.#visits) {
      if (visit.menuId !== menuId) continue;
      total += visit.completed ? 1 : w;
    }
    const agg = this.#aggregates[menuId];
    if (agg) total += agg.completed + agg.incomplete * w;

    return total;
  }

  /** 최신성 항의 입력값. 집계로 접힌 오래된 사용도 시각을 잃지 않는다. */
  lastUsedAt(menuId: MenuId): number | null {
    let last: number | null = null;
    for (let i = this.#visits.length - 1; i >= 0; i--) {
      const v = this.#visits[i];
      if (v?.menuId === menuId) {
        last = v.at;
        break;
      }
    }
    const agg = this.#aggregates[menuId];
    if (agg) last = last === null ? agg.lastAt : Math.max(last, agg.lastAt);
    return last;
  }

  /** 원본이 남아 있는 방문만. 컨텍스트 주기성 판단에 쓴다. */
  visitsOf(menuId: MenuId): readonly Visit[] {
    return this.#visits.filter((v) => v.menuId === menuId);
  }

  /** 사용 기록이 있는 메뉴 전체 — 랭킹 후보 집합. */
  knownMenuIds(): MenuId[] {
    const ids = new Set<MenuId>(Object.keys(this.#aggregates));
    for (const v of this.#visits) ids.add(v.menuId);
    return [...ids];
  }

  /** 콜드 스타트 종료 판단에 쓰는, 지금까지의 총 방문 수. */
  totalVisitCount(): number {
    let total = this.#visits.length;
    for (const agg of Object.values(this.#aggregates)) {
      total += agg.completed + agg.incomplete;
    }
    return total;
  }

  visits(): readonly Visit[] {
    return this.#visits;
  }

  aggregates(): Readonly<Record<MenuId, VisitAggregate>> {
    return this.#aggregates;
  }

  snapshot(): EventStoreSnapshot {
    return { visits: [...this.#visits], aggregates: { ...this.#aggregates } };
  }
}
