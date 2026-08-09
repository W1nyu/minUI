import { describe, expect, it } from "vitest";
import { contextBoost } from "../src/contextBoost.js";
import { DAY_MS, DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import type { Visit } from "../src/types.js";

const KST = DEFAULT_CONFIG.context.utcOffsetMinutes;

/** KST 기준 연·월·일·시로 방문 하나를 만든다. */
function visitAt(y: number, m: number, d: number, hour: number): Visit {
  return {
    menuId: "transfer.account",
    at: Date.UTC(y, m - 1, d, hour, 0) - KST * 60_000,
    completed: true,
  };
}

function at(y: number, m: number, d: number, hour: number): number {
  return Date.UTC(y, m - 1, d, hour, 0) - KST * 60_000;
}

describe("contextBoost — 지금 쓸 법한 메뉴인가", () => {
  it("관측이 부족하면 패턴을 주장하지 않는다", () => {
    const visits = [visitAt(2025, 11, 25, 10), visitAt(2025, 12, 25, 10)];
    expect(contextBoost(visits, at(2026, 1, 25, 10), DEFAULT_CONFIG)).toBe(0);
  });

  it("매달 25일 쓰던 메뉴는 25일에 부스트를 받는다", () => {
    const visits = [
      visitAt(2025, 10, 25, 10),
      visitAt(2025, 11, 25, 11),
      visitAt(2025, 12, 25, 10),
      visitAt(2026, 1, 25, 10),
    ];
    const boost = contextBoost(visits, at(2026, 2, 25, 10), DEFAULT_CONFIG);
    expect(boost).toBeGreaterThan(0.5);
  });

  it("같은 메뉴라도 주기와 먼 날에는 부스트가 없다", () => {
    const visits = [
      visitAt(2025, 10, 25, 10),
      visitAt(2025, 11, 25, 11),
      visitAt(2025, 12, 25, 10),
      visitAt(2026, 1, 25, 10),
    ];
    const onCycle = contextBoost(visits, at(2026, 2, 25, 10), DEFAULT_CONFIG);
    const offCycle = contextBoost(visits, at(2026, 2, 10, 10), DEFAULT_CONFIG);

    // 주기와 먼 날에도 시간대 축(늘 오전 10시에 쓴다)은 정당하게 살아 있다.
    // 따라서 0이 되기를 요구하지 않고, 주기일 대비 확실히 낮기를 요구한다.
    expect(offCycle).toBeLessThan(onCycle * 0.4);
  });

  it("월말/월초를 가로지르는 주기를 인식한다 (1일과 30일은 가깝다)", () => {
    const visits = [
      visitAt(2025, 10, 31, 9),
      visitAt(2025, 12, 1, 9),
      visitAt(2025, 12, 31, 9),
      visitAt(2026, 1, 31, 9),
    ];
    expect(contextBoost(visits, at(2026, 3, 1, 9), DEFAULT_CONFIG)).toBeGreaterThan(0.4);
  });

  it("하루 안에 몰린 사용은 주기 패턴이 아니다", () => {
    // 오늘 오전에 여섯 번 들어간 메뉴. 날짜도 요일도 당연히 오늘과 일치하지만
    // 서로 다른 달/주/일을 관측한 적이 없으므로 주기성을 주장할 근거가 없다.
    const now = at(2026, 1, 15, 10);
    const visits: Visit[] = Array.from({ length: 6 }, (_, i) => ({
      menuId: "product.loan",
      at: now - i * 3600_000,
      completed: false,
    }));

    expect(contextBoost(visits, now, DEFAULT_CONFIG)).toBe(0);
  });

  it("같은 달 안에서 반복해도 월 주기라고 하지 않는다", () => {
    const visits = [
      visitAt(2026, 1, 25, 10),
      visitAt(2026, 1, 25, 11),
      visitAt(2026, 1, 25, 12),
      visitAt(2026, 1, 25, 13),
    ];
    // 관측된 달이 하나뿐 → 월 축은 0. 시간대 축만 남으므로 낮게 나온다.
    expect(contextBoost(visits, at(2026, 2, 25, 11), DEFAULT_CONFIG)).toBeLessThan(0.2);
  });

  it("패턴 없이 흩어진 사용은 0에 가깝다 — 우연을 패턴으로 세지 않는다", () => {
    const visits: Visit[] = [];
    // 60일에 걸쳐 하루 걸러 한 번씩, 시각도 제각각
    for (let i = 0; i < 30; i++) {
      visits.push({
        menuId: "transfer.account",
        at: at(2025, 11, 1, 0) + i * 2 * DAY_MS + (i % 24) * 3600_000,
        completed: true,
      });
    }
    expect(contextBoost(visits, at(2026, 1, 7, 13), DEFAULT_CONFIG)).toBeLessThan(0.25);
  });

  it("항상 목요일 오전에 쓰던 메뉴는 목요일 오전에 부스트를 받는다", () => {
    const visits = [
      visitAt(2025, 12, 4, 9), // 목
      visitAt(2025, 12, 11, 9),
      visitAt(2025, 12, 18, 10),
      visitAt(2025, 12, 25, 9),
      visitAt(2026, 1, 1, 9),
    ];
    const thursday = contextBoost(visits, at(2026, 1, 8, 9), DEFAULT_CONFIG);
    const saturday = contextBoost(visits, at(2026, 1, 10, 9), DEFAULT_CONFIG);

    expect(thursday).toBeGreaterThan(saturday);
  });

  it("결과는 항상 0과 1 사이다", () => {
    const visits = Array.from({ length: 12 }, (_, i) =>
      visitAt(2025, 1 + (i % 12), 25, 10),
    );
    const boost = contextBoost(visits, at(2026, 2, 25, 10), DEFAULT_CONFIG);
    expect(boost).toBeGreaterThanOrEqual(0);
    expect(boost).toBeLessThanOrEqual(1);
  });

  it("가중치를 0으로 두면 해당 축이 결과에 영향을 주지 않는다", () => {
    const onlyMonthly = resolveConfig({
      context: { weights: { weekday: 0, hourOfDay: 0 } },
    });
    const visits = [
      visitAt(2025, 10, 25, 3),
      visitAt(2025, 11, 25, 14),
      visitAt(2025, 12, 25, 20),
      visitAt(2026, 1, 25, 8),
    ];
    // 시각이 제각각이어도 날짜 주기만으로 높은 점수가 나와야 한다
    expect(contextBoost(visits, at(2026, 2, 25, 22), onlyMonthly)).toBeGreaterThan(0.8);
  });
});
