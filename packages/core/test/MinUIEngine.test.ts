import { beforeEach, describe, expect, it, vi } from "vitest";
import { MinUIEngine } from "../src/MinUIEngine.js";
import { MemoryStorageAdapter } from "../src/storage/MemoryStorageAdapter.js";
import { DAY_MS, DEFAULT_CONFIG, type PartialConfig } from "../src/config.js";
import type {
  ColdStartPresets,
  MenuId,
  PersistedState,
  StorageAdapter,
} from "../src/types.js";
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
    open(
      overrides: { presets?: ColdStartPresets | null; config?: PartialConfig } = {},
    ) {
      const presets = overrides.presets === undefined ? PRESETS : overrides.presets;
      return MinUIEngine.create({
        catalog: CATALOG,
        onAction: (menuId) => opened.push(menuId),
        storage,
        now: () => now,
        ...(presets ? { coldStartPresets: presets } : {}),
        ...(overrides.config ? { config: overrides.config } : {}),
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

describe("stability.liveReorder", () => {
  const LIVE: PartialConfig = { stability: { liveReorder: true } };

  it("꺼져 있으면 아무리 눌러도 세션 도중 카드가 그대로다 (기본값)", async () => {
    const h = harness();
    const engine = await h.open();
    const before = engine.getCards().map((c) => c.menuId);

    // 프리셋에 없는 메뉴를 20번 쓴다.
    await warmUp(engine, "product.loan", 20);

    expect(engine.getCards().map((c) => c.menuId)).toEqual(before);
    expect(before).not.toContain("product.loan");
  });

  it("켜면 많이 쓴 메뉴가 그 자리에서 카드로 올라온다", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });
    const before = engine.getCards().map((c) => c.menuId);
    expect(before).not.toContain("product.loan");

    await warmUp(engine, "product.loan", 3);

    expect(engine.getCards().map((c) => c.menuId)).toContain("product.loan");
  });

  it("켜도 한 번에 한 장만 바뀐다 — 화면이 통째로 뒤집히지 않는다", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });
    const before = engine.getCards().map((c) => c.menuId);

    engine.open("product.loan");
    engine.complete("product.loan");
    await engine.flush();

    const after = engine.getCards().map((c) => c.menuId);
    const changed = after.filter((id) => !before.includes(id));
    expect(changed).toHaveLength(1);
  });

  it("켜도 고정한 카드는 밀려나지 않는다", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    await engine.pin("settings.limit");
    await warmUp(engine, "product.loan", 30);

    expect(engine.getCards().map((c) => c.menuId)).toContain("settings.limit");
  });

  it("아무도 쓰지 않았으면 프리셋이 그대로 남는다", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    expect(engine.getCards().map((c) => c.menuId)).toEqual([
      "inquiry.balance",
      "inquiry.history",
      "transfer.account",
      "settings.limit",
    ]);
  });

  it("cardable: false인 메뉴는 아무리 써도 카드가 되지 않는다", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    await warmUp(engine, "market.quote", 30);

    expect(engine.getCards().map((c) => c.menuId)).not.toContain("market.quote");
  });
});

describe("카드 순서 — 중요한 것이 앞에", () => {
  const LIVE: PartialConfig = { stability: { liveReorder: true } };

  /** n번 열고 닫는다. 시각을 조금씩 밀어 최신성 순서를 만든다. */
  async function view(engine: MinUIEngine, h: ReturnType<typeof harness>, menuId: MenuId, times: number) {
    for (let i = 0; i < times; i++) {
      h.advance(60_000);
      engine.open(menuId);
      engine.complete(menuId);
    }
    await engine.flush();
  }

  it("고정하지 않은 카드는 조회 횟수가 많은 것부터", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    await view(engine, h, "inquiry.history", 5);
    await view(engine, h, "inquiry.balance", 9);
    await view(engine, h, "transfer.account", 7);

    const order = engine.getCards().map((c) => c.menuId);
    expect(order.slice(0, 3)).toEqual([
      "inquiry.balance",
      "transfer.account",
      "inquiry.history",
    ]);
  });

  it("횟수가 같으면 최근에 본 것이 앞에", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    await view(engine, h, "inquiry.balance", 4);
    await view(engine, h, "inquiry.history", 4);

    expect(engine.getCards().map((c) => c.menuId).slice(0, 2)).toEqual([
      "inquiry.history",
      "inquiry.balance",
    ]);
  });

  it("고정한 카드가 1행 1열에 온다 — 더 많이 본 카드가 있어도", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    await view(engine, h, "inquiry.balance", 20);
    await engine.pin("settings.limit");

    const cards = engine.getCards();
    expect(cards[0]?.menuId).toBe("settings.limit");
    expect(cards[0]?.pinned).toBe(true);
  });

  it("고정한 것끼리는 먼저 고정한 순서 — 조회 횟수가 같을 때", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    await engine.pin("settings.limit");
    await engine.pin("product.loan");

    expect(engine.getCards().map((c) => c.menuId).slice(0, 2)).toEqual([
      "settings.limit",
      "product.loan",
    ]);
  });

  it("나중에 고정했어도 더 많이 보면 앞으로 온다", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    await engine.pin("settings.limit");
    await view(engine, h, "settings.limit", 3);
    await engine.pin("product.loan");
    await view(engine, h, "product.loan", 4);

    expect(engine.getCards().map((c) => c.menuId).slice(0, 2)).toEqual([
      "product.loan",
      "settings.limit",
    ]);
  });

  it("나중에 고정한 것이 덜 보였으면 뒤에 남는다", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    await engine.pin("settings.limit");
    await view(engine, h, "settings.limit", 5);
    await engine.pin("product.loan");
    await view(engine, h, "product.loan", 5);

    // 횟수가 같으므로 고정 순서가 이긴다.
    expect(engine.getCards().map((c) => c.menuId).slice(0, 2)).toEqual([
      "settings.limit",
      "product.loan",
    ]);
  });

  it("아무 기록도 없으면 프리셋 순서가 그대로 남는다", async () => {
    const h = harness();
    const engine = await h.open({ config: LIVE });

    expect(engine.getCards().map((c) => c.menuId)).toEqual([
      "inquiry.balance",
      "inquiry.history",
      "transfer.account",
      "settings.limit",
    ]);
  });
});

/**
 * 개인 동의어 학습 (M7).
 *
 * <p>엔진 쪽에서 지켜야 하는 것은 <b>학습이 안전 경계를 흔들지 않는다</b>는 것과,
 * <b>사용자가 그것을 지울 수 있다</b>는 것이다. 배우는 규칙 자체는 `LearnedTerms`가 잰다.
 */
describe("개인 동의어 학습 (M7)", () => {
  it("검색이 놓친 말로 메뉴에 도달하면 그 말을 배운다", async () => {
    const h = harness();
    const engine = await h.open();

    expect(engine.search("관리비").status).toBe("unclear");

    engine.noteSearchChoice("관리비", "transfer.auto");

    const after = engine.search("관리비");
    expect(after.status).toBe("ok");
    if (after.status !== "ok") return;
    expect(after.candidates[0]!.menuId).toBe("transfer.auto");
    expect(after.candidates[0]!.matchedBy).toBe("learned");
  });

  it("이미 1위로 찾던 말은 배우지 않는다", async () => {
    const h = harness();
    const engine = await h.open();

    engine.noteSearchChoice("계좌 이체", "transfer.account");

    expect(engine.getLearnedTerms()).toEqual([]);
  });

  it("카탈로그에 없는 메뉴는 배우지 않는다", async () => {
    const h = harness();
    const engine = await h.open();

    engine.noteSearchChoice("관리비", "없는메뉴");

    expect(engine.getLearnedTerms()).toEqual([]);
  });

  /*
   * §9.3의 안전 경계는 학습과 무관하게 성립해야 한다. 학습 점수는 반복될수록 오르므로
   * 언젠가 자동 실행 문턱(autoOpenConfidence)을 넘는데, **위험한 메뉴는 그래도 열리면
   * 안 된다.** 이 경계가 학습으로 뚫리면 "말로 이체가 실행되는" 경로가 생긴다.
   */
  it("위험한 메뉴는 아무리 배워도 자동 실행되지 않는다", async () => {
    const h = harness();
    const engine = await h.open();

    for (let i = 0; i < 10; i++) engine.noteSearchChoice("관리비", "transfer.account");

    const action = engine.voiceAction("관리비");
    expect(action.kind).toBe("choose");
  });

  it("조회성 메뉴는 충분히 배우면 바로 열린다", async () => {
    const h = harness();
    const engine = await h.open();

    for (let i = 0; i < 10; i++) engine.noteSearchChoice("관리비", "inquiry.history");

    expect(engine.voiceAction("관리비")).toEqual({
      kind: "open",
      menuId: "inquiry.history",
    });
  });

  it("배운 것은 다음 세션에도 남아 있다", async () => {
    const h = harness();
    const first = await h.open();
    first.noteSearchChoice("관리비", "transfer.auto");
    await first.close();

    h.advance(DAY_MS);
    const second = await h.open();

    expect(second.search("관리비").status).toBe("ok");
  });

  it("오래 안 쓴 말은 세션이 열릴 때 잊는다", async () => {
    const h = harness();
    const first = await h.open();
    first.noteSearchChoice("관리비", "transfer.auto");
    await first.close();

    h.advance((DEFAULT_CONFIG.learning.forgetAfterDays + 1) * DAY_MS);
    const second = await h.open();

    expect(second.getLearnedTerms()).toEqual([]);
    expect(second.search("관리비").status).toBe("unclear");
  });

  /*
   * 기기에 남는 것은 사용자가 볼 수 있고 지울 수 있어야 한다. 보여 주는 화면은 M8이
   * 만들지만, 지울 수 있다는 사실 자체는 저장을 시작하는 이 단계에서 성립해야 한다.
   */
  it("사용자가 배운 것을 지울 수 있다", async () => {
    const h = harness();
    const engine = await h.open();
    engine.noteSearchChoice("관리비", "transfer.auto");

    await engine.forgetTerm("관리비", "transfer.auto");

    expect(engine.getLearnedTerms()).toEqual([]);
    expect(engine.search("관리비").status).toBe("unclear");
  });

  it("사용자가 배운 것을 전부 지울 수 있고, 지운 것은 다음 세션에도 없다", async () => {
    const h = harness();
    const engine = await h.open();
    engine.noteSearchChoice("관리비", "transfer.auto");
    engine.noteSearchChoice("빌린돈", "product.loan");

    await engine.forgetAllTerms();
    await engine.close();

    const second = await h.open();
    expect(second.getLearnedTerms()).toEqual([]);
  });

  it("학습을 끄면 아무것도 적히지 않는다", async () => {
    const h = harness();
    const engine = await h.open({ config: { learning: { enabled: false } } });

    engine.noteSearchChoice("관리비", "transfer.auto");

    expect(engine.getLearnedTerms()).toEqual([]);
    expect(engine.search("관리비").status).toBe("unclear");
  });

  it("학습 기록이 없는 옛 저장본에서도 그대로 열린다", async () => {
    const h = harness();
    const engine = await h.open();
    await engine.close();

    // M7 이전에 저장된 상태 — `learned` 필드가 아예 없다.
    const old = await h.storage.load();
    const { learned: _learned, ...withoutLearned } = old as unknown as Record<string, unknown>;
    await h.storage.save(withoutLearned as unknown as PersistedState);

    const reopened = await h.open();
    expect(reopened.getLearnedTerms()).toEqual([]);
  });
});

/**
 * 적응했다는 것을 사용자가 알 수 있게 (M8).
 *
 * <p>개인화는 조용히 일어난다. 조용한 것이 P3의 목적이지만, **물어봤을 때 답하지 못하면
 * 그것은 조용한 게 아니라 깜깜한 것이다.** 화면이 왜 이렇게 생겼는지는 엔진만 안다 —
 * UI가 점수를 다시 해석하게 두면 화면이 하는 설명과 엔진의 판단이 갈린다.
 */
describe("카드가 왜 여기 있는가 (M8)", () => {
  it("카드와 같은 순서로, 카드 수만큼 준다", async () => {
    const h = harness();
    const engine = await h.open();

    expect(engine.explainCards().map((entry) => entry.menuId)).toEqual(
      engine.getCards().map((card) => card.menuId),
    );
  });

  it("기록이 없으면 처음이라 놓인 것이다", async () => {
    const h = harness();
    const engine = await h.open();

    expect(engine.explainCards()[0]!.reason).toEqual({ kind: "preset" });
  });

  /*
   * 횟수를 그대로 주는 것이 요점이다. 점수(`frequency`)는 로그를 씌우고 미완료 방문에
   * 0.25를 곱한 값이라 사람에게 보여 줄 수 없다 — "1.79점이라 여기 있어요"는 설명이 아니다.
   */
  it("쓴 카드는 몇 번 썼는지와 마지막이 언제인지를 준다", async () => {
    const h = harness();
    const engine = await h.open({ config: { stability: { liveReorder: true } } });

    await warmUp(engine, "product.loan", 3);

    const reason = engine.explainCards().find((e) => e.menuId === "product.loan")?.reason;
    expect(reason).toEqual({ kind: "used", views: 3, lastUsedAt: h.now });
  });

  it("고정한 카드는 고정이 이유다 — 많이 썼더라도", async () => {
    const h = harness();
    const engine = await h.open({ config: { stability: { liveReorder: true } } });

    await warmUp(engine, "product.loan", 5);
    await engine.pin("product.loan");

    expect(
      engine.explainCards().find((e) => e.menuId === "product.loan")?.reason,
    ).toEqual({ kind: "pinned" });
  });

  it("새로 온 카드라는 사실을 이유와 따로 알려준다", async () => {
    const h = harness();
    let engine = await h.open();
    await warmUp(engine, "product.loan", 12);
    await engine.close();

    h.advance(DAY_MS + 3600_000);
    engine = await h.open();
    await engine.close();

    h.advance(DAY_MS);
    engine = await h.open();

    const entry = engine.explainCards().find((e) => e.menuId === "product.loan")!;
    expect(entry.isNew).toBe(true);
    // 변화 고지(F3)는 "왜 여기 있는가"와 다른 정보다. 둘을 합치면 배지가 사라진 뒤
    // 이유까지 사라진다.
    expect(entry.reason.kind).toBe("used");
  });
});

/**
 * 원격 신경망 검색의 얇은 껍데기 (M11).
 *
 * <p>판단은 전부 `mergeNeural`(순수·동기)에 있고, 여기가 지는 책임은 <b>둘뿐</b>이다 —
 * 시간 초과와 예외. 그래서 이 describe가 재는 것도 그 둘과, 언제 부르지 않는가이다.
 *
 * <p>가장 중요한 것은 첫 테스트다. 불변 규칙 9는 "원격이 없어도 <b>돈다</b>"가 아니라
 * "<b>같게</b> 돈다"여야 한다 — 모델이 있고 없고에 따라 사용자가 보는 후보가 달라지면
 * 오프라인 바닥이 바닥이 아니게 된다.
 */
describe("원격 검색 (M11)", () => {
  async function engineWith(
    retrieve?: (query: string) => Promise<readonly { menuId: string; score: number }[]>,
    neural: Record<string, unknown> = {},
  ) {
    return MinUIEngine.create({
      catalog: CATALOG,
      onAction: () => {},
      storage: new MemoryStorageAdapter(),
      now: () => T0,
      ...(retrieve ? { retrieve } : {}),
      config: { search: { neural: { enabled: true, ...neural } } },
    });
  }

  it("retrieve가 없으면 search()와 완전히 같다", async () => {
    const engine = await engineWith();

    expect(await engine.searchWithRetrieval("이체")).toEqual(engine.search("이체"));
    expect(await engine.searchWithRetrieval("알아들을수없는말")).toEqual(
      engine.search("알아들을수없는말"),
    );
  });

  it("retrieve가 던져도 로컬 결과가 나온다 — 원격이 죽어도 100% 돈다", async () => {
    const engine = await engineWith(() => Promise.reject(new Error("서버 없음")));

    expect(await engine.searchWithRetrieval("이체")).toEqual(engine.search("이체"));
  });

  it("시간을 재는 일은 core가 하지 않는다 — 상한은 호스트가 씌운다", async () => {
    /*
     * 처음에는 여기서 `setTimeout`으로 상한을 뒀는데 `portability.test.ts`가 잡았다.
     * 불변 규칙 1은 core가 Node·브라우저 전역에 손대는 것을 금하고, 그 테스트가 옳다 —
     * 엔진이 `Date.now()` 대신 주입된 `now`를 쓰는 것과 같은 이유다.
     *
     * 그래서 계약이 이렇게 갈린다: **늦게 오는 것을 재는 것은 시계를 가진 층의 일이고,
     * core는 온 것을 합치기만 한다.** 상한은 `MinUIProvider`가 `neural.timeoutMs`로 씌우고
     * (`packages/react`가 재는 자리), 값은 규칙 3대로 `MinUIConfig`에 남는다.
     *
     * 여기서 재는 것은 그 계약의 나머지 절반 — **거부는 언제나 로컬로 떨어진다.**
     * 상한을 씌운 층이 시간이 넘었을 때 하는 일이 바로 거부이므로, 이 경로가 곧 그 경로다.
     */
    const engine = await engineWith(() => Promise.reject(new Error("시간 초과")));

    expect(await engine.searchWithRetrieval("알아들을수없는말")).toEqual(
      engine.search("알아들을수없는말"),
    );
  });

  it("enabled가 false면 부르지 않는다", async () => {
    let calls = 0;
    const engine = await MinUIEngine.create({
      catalog: CATALOG,
      onAction: () => {},
      storage: new MemoryStorageAdapter(),
      now: () => T0,
      retrieve: async () => {
        calls += 1;
        return [];
      },
    });

    await engine.searchWithRetrieval("알아들을수없는말");

    expect(calls).toBe(0);
  });

  it("로컬이 확신하면 원격을 부르지 않는다", async () => {
    // 85%의 질의가 로컬에서 끝난다. 그때마다 서버를 부르면 값도 지연도 낭비다.
    let calls = 0;
    const engine = await engineWith(async () => {
      calls += 1;
      return [];
    });

    await engine.searchWithRetrieval("잔액 보기");

    expect(calls).toBe(0);
  });

  it("로컬이 못 찾으면 원격이 데려온 것을 후보로 낸다", async () => {
    const engine = await engineWith(async () => [
      { menuId: "transfer.account", score: 0.95 },
    ]);

    const outcome = await engine.searchWithRetrieval("돈보내다");

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.candidates[0]).toMatchObject({
      menuId: "transfer.account",
      matchedBy: "neural",
    });
  });

  it("음성 경로도 같은 안전 함수를 지난다", async () => {
    /*
     * `resolveVoiceAction`을 두 번 구현하면 §9.3이 한쪽에서만 지켜진다. 원격이 1.0으로
     * 확신해도 열리지 않아야 한다 — 규칙 8의 일반형(`NEVER_AUTO_OPEN`).
     */
    const engine = await engineWith(async () => [{ menuId: "inquiry.balance", score: 1 }]);

    const action = await engine.voiceActionWithRetrieval("돈보내다");

    expect(action.kind).not.toBe("open");
  });
});
