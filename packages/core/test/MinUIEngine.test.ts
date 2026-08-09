import { beforeEach, describe, expect, it, vi } from "vitest";
import { MinUIEngine } from "../src/MinUIEngine.js";
import { MemoryStorageAdapter } from "../src/storage/MemoryStorageAdapter.js";
import { DAY_MS, DEFAULT_CONFIG } from "../src/config.js";
import type { ColdStartPresets, MenuId, StorageAdapter } from "../src/types.js";
import { CATALOG, T0 } from "./helpers.js";

const PRESETS: ColdStartPresets = {
  inquiry: ["inquiry.balance", "inquiry.history", "transfer.account", "settings.limit"],
  transfer: ["transfer.account", "transfer.auto", "inquiry.balance", "inquiry.history"],
  invest: ["product.loan", "inquiry.balance", "inquiry.history", "transfer.account"],
};

/** 시각을 마음대로 돌릴 수 있는 세션 하네스. */
function harness() {
  const storage = new MemoryStorageAdapter();
  const opened: MenuId[] = [];
  let now = T0;

  return {
    storage,
    opened,
    set now(value: number) {
      now = value;
    },
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
    /** `presets: null`을 주면 프리셋 없이 연다. */
    open(overrides: { presets?: ColdStartPresets | null } = {}) {
      const presets = overrides.presets === undefined ? PRESETS : overrides.presets;
      return MinUIEngine.create({
        catalog: CATALOG,
        onAction: (menuId) => opened.push(menuId),
        storage,
        now: () => now,
        ...(presets ? { coldStartPresets: presets } : {}),
      });
    },
  };
}

/** 콜드 스타트를 벗어날 만큼 사용한다. */
async function warmUp(engine: MinUIEngine, menuId: MenuId, times: number) {
  for (let i = 0; i < times; i++) {
    engine.open(menuId);
    engine.complete(menuId);
  }
  await engine.flush();
}

describe("콜드 스타트 (기획안 F5)", () => {
  it("최초 실행에는 프로파일 프리셋이 카드가 된다", async () => {
    const h = harness();
    const engine = await h.open();

    expect(engine.getCards().map((c) => c.menuId)).toEqual([
      "inquiry.balance",
      "inquiry.history",
      "transfer.account",
      "settings.limit",
    ]);
  });

  it("온보딩 답에 따라 첫 화면이 달라진다", async () => {
    const h = harness();
    const engine = await h.open();
    await engine.setProfile({ intent: "transfer", textScale: "large" });

    expect(engine.getCards().map((c) => c.menuId)).toEqual([
      "transfer.account",
      "transfer.auto",
      "inquiry.balance",
      "inquiry.history",
    ]);
  });

  it("프리셋을 주지 않으면 카탈로그 순서를 쓴다", async () => {
    const h = harness();
    const engine = await h.open({ presets: null });

    expect(engine.getCards().map((c) => c.menuId)).toEqual([
      "inquiry.balance",
      "transfer.account",
      "inquiry.history",
      "transfer.auto",
    ]);
  });

  it("카드로 올릴 수 없는 메뉴는 프리셋에 있어도 제외된다", async () => {
    const h = harness();
    const engine = await h.open({
      presets: { ...PRESETS, inquiry: ["market.quote", "inquiry.balance"] },
    });

    expect(engine.getCards().map((c) => c.menuId)).not.toContain("market.quote");
  });

  it("사용이 쌓이기 전에는 재배치가 일어나지 않는다", async () => {
    // 설치 이틀째 잘못 누른 탭 한 번이 온보딩으로 정한 카드를 밀어내면 안 된다.
    const h = harness();
    let engine = await h.open();
    const before = engine.getCards().map((c) => c.menuId);

    engine.open("product.loan");
    engine.complete("product.loan");
    await engine.close();

    h.advance(5 * DAY_MS);
    engine = await h.open();

    expect(engine.getCards().map((c) => c.menuId)).toEqual(before);
    expect(engine.inColdStart()).toBe(true);
  });
});

describe("세션 안정성 — 원칙 P3", () => {
  it("세션 도중에는 무엇을 해도 카드가 바뀌지 않는다", async () => {
    const h = harness();
    const engine = await h.open();
    const before = engine.getCards().map((c) => c.menuId);

    // 카드에 없는 메뉴를 세션 내내 집중적으로 쓴다
    for (let i = 0; i < 30; i++) {
      h.advance(3600_000);
      engine.open("product.loan");
      engine.complete("product.loan");
    }
    await engine.flush();

    expect(engine.getCards().map((c) => c.menuId)).toEqual(before);
  });

  it("교체는 다음 세션에서야 보인다", async () => {
    const h = harness();
    let engine = await h.open();

    await warmUp(engine, "product.loan", 12);
    await engine.close();

    // 하루 뒤 두 번째 세션: 이번 세션에서 재배치가 *결정*된다
    h.advance(DAY_MS + 3600_000);
    engine = await h.open();
    const secondSession = engine.getCards().map((c) => c.menuId);
    expect(secondSession).not.toContain("product.loan");
    await engine.close();

    // 세 번째 세션에서 반영된다
    h.advance(DAY_MS);
    engine = await h.open();
    expect(engine.getCards().map((c) => c.menuId)).toContain("product.loan");
  });

  it("교체는 한 세션에 한 장씩만 일어난다", async () => {
    const h = harness();
    let engine = await h.open();

    await warmUp(engine, "product.loan", 12);
    await warmUp(engine, "transfer.auto", 12);
    await engine.close();

    const seen: string[][] = [];
    for (let i = 0; i < 4; i++) {
      h.advance(DAY_MS + 3600_000);
      engine = await h.open();
      seen.push(engine.getCards().map((c) => c.menuId));
      await engine.close();
    }

    for (let i = 1; i < seen.length; i++) {
      const changed = seen[i]!.filter((id) => !seen[i - 1]!.includes(id));
      expect(changed.length).toBeLessThanOrEqual(1);
    }
  });

  it("새로 들어온 카드에 배지가 붙는다", async () => {
    const h = harness();
    let engine = await h.open();
    await warmUp(engine, "product.loan", 12);
    await engine.close();

    h.advance(DAY_MS + 3600_000);
    engine = await h.open();
    await engine.close();

    h.advance(DAY_MS);
    engine = await h.open();
    const badged = engine.getCards().filter((c) => c.isNew).map((c) => c.menuId);

    expect(badged).toEqual(["product.loan"]);
  });
});

describe("이식 계약", () => {
  it("open()은 호스트의 ActionHandler를 부르고 사용을 기록한다", async () => {
    const h = harness();
    const engine = await h.open();

    engine.open("transfer.account", { recipient: "prefilled" });

    expect(h.opened).toEqual(["transfer.account"]);
    expect(engine.explain().find((r) => r.menuId === "transfer.account")!.total)
      .toBeGreaterThan(0);
  });

  it("카탈로그에 없는 메뉴는 열지 않는다", async () => {
    const h = harness();
    const engine = await h.open();

    engine.open("does.not.exist");

    expect(h.opened).toEqual([]);
  });

  it("riskLevel:high 메뉴도 탭으로는 열린다 — 막는 것은 음성 자동 실행뿐이다", async () => {
    const h = harness();
    const engine = await h.open();

    engine.open("transfer.account");

    expect(h.opened).toEqual(["transfer.account"]);
  });

  it("전체 메뉴는 언제나 100% 노출된다 (원칙 P2)", async () => {
    const h = harness();
    const engine = await h.open();

    expect(engine.getAllMenus()).toHaveLength(CATALOG.length);
  });
});

describe("영속성", () => {
  it("세션을 넘어 사용 기록이 이어진다", async () => {
    const h = harness();
    let engine = await h.open();
    await warmUp(engine, "product.loan", 5);
    const before = engine.explain().find((r) => r.menuId === "product.loan")!.total;
    await engine.close();

    engine = await h.open();
    const after = engine.explain().find((r) => r.menuId === "product.loan")!.total;

    expect(after).toBeCloseTo(before, 6);
  });

  it("저장 상태는 JSON으로 왕복 가능하다", async () => {
    const h = harness();
    const engine = await h.open();
    await warmUp(engine, "inquiry.history", 3);
    await engine.close();

    const saved = await h.storage.load();
    expect(saved).not.toBeNull();
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });

  it("저장이 실패하면 flush()가 알린다 — 조용히 삼키지 않는다", async () => {
    const failing: StorageAdapter = {
      load: async () => null,
      save: async () => {
        throw new Error("quota exceeded");
      },
    };
    const opened: MenuId[] = [];

    await expect(
      MinUIEngine.create({
        catalog: CATALOG,
        onAction: (id) => opened.push(id),
        storage: failing,
        now: () => T0,
      }),
    ).rejects.toThrow("quota exceeded");
  });

  it("저장을 아무도 기다리지 않아도 unhandled rejection이 생기지 않는다", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const engine = await MinUIEngine.create({
      catalog: CATALOG,
      onAction: () => {},
      storage: { load: async () => null, save: async () => {} },
      now: () => T0,
    });
    engine.open("inquiry.balance"); // flush 하지 않는다
    await new Promise((r) => setTimeout(r, 20));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("수동 고정 — 자동화의 탈출구", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it("고정하면 그 자리에서 바로 카드에 들어온다", async () => {
    const engine = await h.open();
    expect(engine.getCards().map((c) => c.menuId)).not.toContain("transfer.auto");

    await engine.pin("transfer.auto");

    expect(engine.getCards().map((c) => c.menuId)).toContain("transfer.auto");
    expect(engine.isPinned("transfer.auto")).toBe(true);
  });

  it("프리셋 순서상 맨 뒤에 있는 메뉴를 고정해도 바로 올라온다", async () => {
    // 콜드 스타트 랭킹은 프리셋 순서로 만들어져 점수 순이 아니다.
    // 고정한 메뉴가 그 배열의 끝에 있어도 도전자로 뽑혀야 한다.
    const engine = await h.open();

    await engine.pin("product.loan"); // 카탈로그 맨 뒤의 카드 가능 메뉴

    expect(engine.getCards().map((c) => c.menuId)).toContain("product.loan");
  });

  it("고정 카드는 아무리 안 써도 밀려나지 않는다", async () => {
    let engine = await h.open();
    await engine.pin("settings.limit");
    await warmUp(engine, "product.loan", 20);
    await engine.close();

    for (let i = 0; i < 5; i++) {
      h.advance(DAY_MS + 3600_000);
      engine = await h.open();
      expect(engine.getCards().map((c) => c.menuId)).toContain("settings.limit");
      await engine.close();
    }
  });

  it("고정은 재시작 후에도 유지된다", async () => {
    let engine = await h.open();
    await engine.pin("settings.limit");
    await engine.close();

    h.advance(DAY_MS);
    engine = await h.open();

    expect(engine.isPinned("settings.limit")).toBe(true);
  });

  it("고정을 풀어도 카드는 그 자리에 남는다", async () => {
    const engine = await h.open();
    await engine.pin("transfer.auto");
    await engine.unpin("transfer.auto");

    expect(engine.isPinned("transfer.auto")).toBe(false);
    expect(engine.getCards().map((c) => c.menuId)).toContain("transfer.auto");
  });
});

describe("보존 기간", () => {
  it("90일이 지난 기록은 원본이 사라지고 집계만 남는다", async () => {
    const h = harness();
    let engine = await h.open();
    await warmUp(engine, "inquiry.history", 4);
    await engine.close();

    const beforeScore = (await h.storage.load())!.visits.length;
    expect(beforeScore).toBeGreaterThan(0);

    h.advance((DEFAULT_CONFIG.retention.rawVisitWindowDays + 1) * DAY_MS);
    engine = await h.open();
    await engine.close();

    const saved = (await h.storage.load())!;
    expect(saved.visits).toHaveLength(0);
    expect(saved.aggregates["inquiry.history"]?.completed).toBe(4);
  });
});
