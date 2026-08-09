import { describe, expect, it } from "vitest";
import { RankingEngine } from "../src/RankingEngine.js";
import { DAY_MS, DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import { CATALOG, T0, bounceMenu, makeStore, useMenu } from "./helpers.js";

function rank(store: ReturnType<typeof makeStore>, now = T0, pinned: string[] = []) {
  return new RankingEngine(DEFAULT_CONFIG, store).scoreAll({
    catalog: CATALOG,
    now,
    pinned,
  });
}

describe("랭킹 — 상위 N개 산출", () => {
  it("많이 쓴 메뉴가 위로 온다", () => {
    const s = makeStore();
    for (let i = 0; i < 10; i++) useMenu(s, "transfer.account", T0 - i * DAY_MS);
    for (let i = 0; i < 2; i++) useMenu(s, "inquiry.history", T0 - i * DAY_MS);

    const order = rank(s).map((r) => r.menuId);
    expect(order.indexOf("transfer.account")).toBeLessThan(
      order.indexOf("inquiry.history"),
    );
  });

  it("빈도에 로그를 씌워 다빈도 메뉴의 독점을 막는다", () => {
    const s = makeStore();
    for (let i = 0; i < 20; i++) useMenu(s, "transfer.account", T0 - i * 3600_000);
    useMenu(s, "inquiry.balance", T0);

    const byId = Object.fromEntries(rank(s).map((r) => [r.menuId, r]));
    const heavy = byId["transfer.account"]!.frequency;
    const light = byId["inquiry.balance"]!.frequency;

    // 20배 사용했지만 점수는 20배가 아니다
    expect(heavy / light).toBeLessThan(5);
    expect(heavy).toBeGreaterThan(light);
  });

  it("빈도가 같으면 최근에 쓴 쪽이 위다", () => {
    const s = makeStore();
    useMenu(s, "inquiry.balance", T0 - 30 * DAY_MS);
    useMenu(s, "inquiry.history", T0 - 1 * DAY_MS);

    const order = rank(s).map((r) => r.menuId);
    expect(order.indexOf("inquiry.history")).toBeLessThan(
      order.indexOf("inquiry.balance"),
    );
  });

  it("최신성 반감기는 약 14일이다 (λ=0.05/일)", () => {
    const s = makeStore();
    useMenu(s, "inquiry.balance", T0 - 14 * DAY_MS);

    const r = rank(s).find((x) => x.menuId === "inquiry.balance")!;
    const halfOfWeight = DEFAULT_CONFIG.ranking.weights.recency * 0.5;
    expect(r.recency).toBeCloseTo(halfOfWeight, 2);
  });

  it("한 번도 안 쓴 메뉴는 최신성 점수가 0이다", () => {
    const r = rank(makeStore()).find((x) => x.menuId === "product.loan")!;
    expect(r.recency).toBe(0);
    expect(r.frequency).toBe(0);
    expect(r.total).toBe(0);
  });

  it("같은 횟수라면 들어갔다 나온 메뉴가 제대로 쓴 메뉴 아래에 온다", () => {
    const s = makeStore();
    for (let i = 0; i < 4; i++) {
      bounceMenu(s, "product.loan", T0 - i * DAY_MS);
      useMenu(s, "inquiry.balance", T0 - i * DAY_MS);
    }

    const order = rank(s).map((r) => r.menuId);
    expect(order.indexOf("inquiry.balance")).toBeLessThan(order.indexOf("product.loan"));
  });

  it("완료 1회의 빈도 기여는 미완료 4회와 같다 (incompleteVisitWeight = 0.25)", () => {
    // 이 교환비는 법칙이 아니라 설정값이다. 테스트는 설정이 실제로 그렇게 동작하는지만 고정한다.
    const s = makeStore();
    for (let i = 0; i < 4; i++) bounceMenu(s, "product.loan", T0 - i * DAY_MS);
    useMenu(s, "inquiry.balance", T0 - 3 * DAY_MS);

    const byId = Object.fromEntries(rank(s).map((r) => [r.menuId, r]));
    expect(byId["product.loan"]!.frequency).toBeCloseTo(
      byId["inquiry.balance"]!.frequency,
      6,
    );
  });
});

describe("고정(핀)", () => {
  it("한 번도 안 쓴 메뉴라도 고정하면 최상위다", () => {
    const s = makeStore();
    for (let i = 0; i < 20; i++) useMenu(s, "transfer.account", T0 - i * 3600_000);

    const ranked = rank(s, T0, ["settings.limit"]);
    expect(ranked[0]?.menuId).toBe("settings.limit");
  });

  it("고정 카드가 여러 개면 그들끼리는 점수 순이다", () => {
    const s = makeStore();
    useMenu(s, "inquiry.history", T0);

    const ranked = rank(s, T0, ["settings.limit", "inquiry.history"]);
    expect(ranked.slice(0, 2).map((r) => r.menuId)).toEqual([
      "inquiry.history",
      "settings.limit",
    ]);
  });
});

describe("후보 집합", () => {
  it("cardable:false 메뉴는 카드 후보에서 빠진다", () => {
    const s = makeStore();
    for (let i = 0; i < 30; i++) useMenu(s, "market.quote", T0 - i * 3600_000);

    expect(rank(s).some((r) => r.menuId === "market.quote")).toBe(false);
  });

  it("카탈로그에 없는 메뉴의 사용 기록은 무시한다", () => {
    const s = makeStore();
    for (let i = 0; i < 30; i++) useMenu(s, "legacy.removed", T0 - i * 3600_000);

    expect(rank(s).some((r) => r.menuId === "legacy.removed")).toBe(false);
  });

  it("동점이면 카탈로그 순서를 따른다 — 같은 입력은 항상 같은 화면", () => {
    const s = makeStore();
    const a = rank(s).map((r) => r.menuId);
    const b = rank(s).map((r) => r.menuId);

    expect(a).toEqual(b);
    expect(a).toEqual([
      "inquiry.balance",
      "transfer.account",
      "inquiry.history",
      "transfer.auto",
      "settings.limit",
      "product.loan",
    ]);
  });
});

describe("topN", () => {
  it("설정된 카드 수만큼만 돌려준다", () => {
    const s = makeStore();
    useMenu(s, "inquiry.balance", T0);

    const engine = new RankingEngine(DEFAULT_CONFIG, s);
    expect(engine.topN({ catalog: CATALOG, now: T0, pinned: [] })).toHaveLength(
      DEFAULT_CONFIG.cards.count,
    );
  });

  it("카드 수는 최대치를 넘지 못한다", () => {
    const cfg = resolveConfig({ cards: { count: 99 } });
    const engine = new RankingEngine(cfg, makeStore(cfg));

    expect(
      engine.topN({ catalog: CATALOG, now: T0, pinned: [] }).length,
    ).toBeLessThanOrEqual(cfg.cards.max);
  });
});
