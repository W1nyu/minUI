import { describe, expect, it } from "vitest";
import { EventStore } from "../src/EventStore.js";
import { DAY_MS, DEFAULT_CONFIG } from "../src/config.js";

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0);

function store() {
  return new EventStore(DEFAULT_CONFIG);
}

describe("방문 기록", () => {
  it("menu_enter는 미완료 방문 한 건을 남긴다", () => {
    const s = store();
    s.record({ type: "menu_enter", menuId: "transfer.account" }, T0);

    expect(s.visits()).toEqual([
      { menuId: "transfer.account", at: T0, completed: false },
    ]);
  });

  it("task_complete는 직전 진입을 완료로 바꾼다 — 방문이 두 건으로 세지지 않는다", () => {
    const s = store();
    s.record({ type: "menu_enter", menuId: "transfer.account" }, T0);
    s.record({ type: "task_complete", menuId: "transfer.account" }, T0 + 30_000);

    expect(s.visits()).toEqual([
      { menuId: "transfer.account", at: T0, completed: true },
    ]);
  });

  it("페어링 윈도를 넘긴 task_complete는 별개 방문으로 남는다", () => {
    const s = store();
    const late = DEFAULT_CONFIG.retention.visitPairingWindowMs + 1000;
    s.record({ type: "menu_enter", menuId: "transfer.account" }, T0);
    s.record({ type: "task_complete", menuId: "transfer.account" }, T0 + late);

    expect(s.visits()).toHaveLength(2);
    expect(s.visits()[0]?.completed).toBe(false);
    expect(s.visits()[1]?.completed).toBe(true);
  });

  it("진입 기록 없이 들어온 task_complete도 완료 방문으로 받는다", () => {
    const s = store();
    s.record({ type: "task_complete", menuId: "inquiry.balance" }, T0);

    expect(s.visits()).toEqual([
      { menuId: "inquiry.balance", at: T0, completed: true },
    ]);
  });

  it("다른 메뉴의 완료 이벤트가 남의 방문을 완료시키지 않는다", () => {
    const s = store();
    s.record({ type: "menu_enter", menuId: "transfer.account" }, T0);
    s.record({ type: "task_complete", menuId: "inquiry.balance" }, T0 + 1000);

    expect(s.visits()[0]).toEqual({
      menuId: "transfer.account",
      at: T0,
      completed: false,
    });
  });
});

describe("가중 빈도", () => {
  it("완료 없이 이탈한 방문은 완료 방문보다 훨씬 낮게 센다", () => {
    const s = store();
    // 잘못 들어갔다 바로 나온 메뉴 4번
    for (let i = 0; i < 4; i++) {
      s.record({ type: "menu_enter", menuId: "product.loan" }, T0 + i * 1000);
    }
    // 제대로 쓴 메뉴 1번
    s.record({ type: "menu_enter", menuId: "inquiry.balance" }, T0);
    s.record({ type: "task_complete", menuId: "inquiry.balance" }, T0 + 5_000);

    expect(s.weightedFrequency("product.loan")).toBeCloseTo(1.0, 6);
    expect(s.weightedFrequency("inquiry.balance")).toBeCloseTo(1.0, 6);
    // 4번 잘못 들어간 메뉴가 1번 제대로 쓴 메뉴를 이기지 못한다
    expect(s.weightedFrequency("product.loan")).toBeLessThanOrEqual(
      s.weightedFrequency("inquiry.balance"),
    );
  });

  it("기록이 없는 메뉴는 0이다", () => {
    expect(store().weightedFrequency("never.used")).toBe(0);
  });
});

describe("보존 기간 롤업 (기획안 F1: 최근 90일, 그 이전은 집계만)", () => {
  it("90일을 넘긴 원본 방문은 삭제되고 집계 카운터로 남는다", () => {
    const s = store();
    const old = T0 - 100 * DAY_MS;
    s.record({ type: "menu_enter", menuId: "transfer.account" }, old);
    s.record({ type: "task_complete", menuId: "transfer.account" }, old + 1000);
    s.record({ type: "menu_enter", menuId: "transfer.account" }, T0);

    s.rollup(T0);

    expect(s.visits()).toEqual([
      { menuId: "transfer.account", at: T0, completed: false },
    ]);
    expect(s.aggregates()["transfer.account"]).toEqual({
      completed: 1,
      incomplete: 0,
      lastAt: old,
    });
  });

  it("롤업이 가중 빈도를 바꾸지 않는다 — 오래된 사용도 계속 센다", () => {
    const s = store();
    const old = T0 - 200 * DAY_MS;
    s.record({ type: "menu_enter", menuId: "inquiry.balance" }, old);
    s.record({ type: "task_complete", menuId: "inquiry.balance" }, old + 1000);
    s.record({ type: "menu_enter", menuId: "inquiry.balance" }, T0);

    const before = s.weightedFrequency("inquiry.balance");
    s.rollup(T0);

    expect(s.weightedFrequency("inquiry.balance")).toBeCloseTo(before, 6);
  });

  it("마지막 사용 시각은 롤업 뒤에도 조회된다", () => {
    const s = store();
    const old = T0 - 120 * DAY_MS;
    s.record({ type: "task_complete", menuId: "settings.limit" }, old);
    s.rollup(T0);

    expect(s.visits()).toHaveLength(0);
    expect(s.lastUsedAt("settings.limit")).toBe(old);
  });

  it("한 번도 안 쓴 메뉴의 마지막 사용 시각은 null이다", () => {
    expect(store().lastUsedAt("never.used")).toBeNull();
  });
});

describe("직렬화", () => {
  it("상태를 내보내고 다시 읽으면 같은 결과를 낸다", () => {
    const s = store();
    s.record({ type: "menu_enter", menuId: "transfer.account" }, T0);
    s.record({ type: "task_complete", menuId: "transfer.account" }, T0 + 1000);
    s.record({ type: "menu_enter", menuId: "inquiry.balance" }, T0 + 2000);

    const roundTripped = new EventStore(
      DEFAULT_CONFIG,
      JSON.parse(JSON.stringify({ visits: s.visits(), aggregates: s.aggregates() })),
    );

    expect(roundTripped.visits()).toEqual(s.visits());
    expect(roundTripped.weightedFrequency("transfer.account")).toBe(
      s.weightedFrequency("transfer.account"),
    );
  });
});
