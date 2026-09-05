import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { UNIFORM_COSTS } from "../src/search/confusion.js";
import { extractFeatures, FEATURE_NAMES, type FeatureContext } from "../src/search/features.js";
import { MenuIndex } from "../src/search/MenuIndex.js";
import { rerank, type RerankSettings } from "../src/search/rerank.js";
import type { SearchCandidate } from "../src/search/stages.js";
import type { MenuCatalog, MenuId } from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const CATALOG = JSON.parse(
  readFileSync(join(FIXTURES, "menus.json"), "utf8"),
) as MenuCatalog;

const index = new MenuIndex(CATALOG);
const menus = new Map(index.menus.map((menu) => [menu.menuId, menu]));
const THRESHOLD = DEFAULT_CONFIG.search.minConfidence;

function context(normalized = "이체"): FeatureContext {
  return { normalized, sound: "", topScore: 1, confusion: UNIFORM_COSTS };
}

function candidate(
  menuId: MenuId,
  score: number,
  matchedBy: SearchCandidate["matchedBy"] = "synonym",
): SearchCandidate {
  return { menuId, score, matchedBy, matchedTerm: "이체" };
}

/** 갈래를 눌러 자식을 올리는 가중치. 실패 16건의 주 축을 흉내 낸 것이다. */
const LEARNED: RerankSettings = {
  enabled: true,
  weights: { hasChildren: -1, score: 0.1 },
  margin: 0,
  band: 1,
};

const ids = (list: readonly SearchCandidate[]) => list.map((c) => c.menuId);

describe("특징 추출", () => {
  it("여덟 개를 모두 낸다", () => {
    const menu = index.menus[0]!;
    const features = extractFeatures(candidate(menu.menuId, 0.8), menu, context());
    expect(Object.keys(features).sort()).toEqual([...FEATURE_NAMES].sort());
  });

  it("전부 0과 1 사이다 — 가중치를 사람이 읽을 수 있어야 한다", () => {
    for (const menu of index.menus) {
      const features = extractFeatures(candidate(menu.menuId, 0.9, "exact"), menu, context());
      for (const value of Object.values(features)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("발음 표기가 없으면 소리 특징이 0이다 — 없는 신호를 지어내지 않는다", () => {
    const menu = index.menus[0]!;
    expect(extractFeatures(candidate(menu.menuId, 0.8), menu, context()).sound).toBe(0);
  });

  it("같은 입력에 같은 값이다", () => {
    const menu = index.menus[0]!;
    const a = extractFeatures(candidate(menu.menuId, 0.8), menu, context());
    const b = extractFeatures(candidate(menu.menuId, 0.8), menu, context());
    expect(a).toEqual(b);
  });
});

describe("재순위 — 경계 ★", () => {
  const branch = index.menus.find((m) => m.hasChildren)?.menuId;
  const leaf = index.menus.find((m) => !m.hasChildren)!.menuId;

  it("꺼져 있으면 그대로다 — 기본값이 그것이다", () => {
    const before = [candidate(leaf, 0.9), candidate(index.menus[1]!.menuId, 0.8)];
    expect(rerank(before, menus, DEFAULT_CONFIG.search.rerank, context(), THRESHOLD)).toEqual(before);
    expect(DEFAULT_CONFIG.search.rerank.enabled).toBe(false);
  });

  it("★ 가중치가 비면 입력과 바이트 동일이다 — 적합 전에 켜도 안 바뀐다", () => {
    const before = [candidate(leaf, 0.9), candidate(index.menus[1]!.menuId, 0.8)];
    const empty: RerankSettings = { enabled: true, weights: {}, margin: 0, band: 1 };
    expect(rerank(before, menus, empty, context(), THRESHOLD)).toEqual(before);
  });

  it("★ 정확 매칭이 있으면 아예 돌지 않는다", () => {
    const before = [candidate(leaf, 1, "exact"), candidate(index.menus[1]!.menuId, 0.9)];
    expect(rerank(before, menus, LEARNED, context(), THRESHOLD)).toEqual(before);
  });

  it("★ 문턱 아래는 순서도 자리도 바뀌지 않는다", () => {
    const low = THRESHOLD - 0.05;
    const before = [candidate(leaf, low), candidate(index.menus[1]!.menuId, low - 0.01)];
    expect(rerank(before, menus, LEARNED, context(), THRESHOLD)).toEqual(before);
  });

  it("★ 문턱 위와 아래가 섞이지 않는다", () => {
    const above = candidate(leaf, 0.9);
    const below = candidate(index.menus[1]!.menuId, THRESHOLD - 0.1);
    const after = rerank([above, below], menus, LEARNED, context(), THRESHOLD);
    expect(after[after.length - 1]!.menuId).toBe(below.menuId);
  });

  it("★ 점수를 바꾸지 않는다 — 되묻기 무게와 자동 열기 판정이 흔들리면 안 된다", () => {
    const before = [candidate(leaf, 0.9), candidate(index.menus[1]!.menuId, 0.85)];
    for (const after of rerank(before, menus, LEARNED, context(), THRESHOLD)) {
      const original = before.find((c) => c.menuId === after.menuId)!;
      expect(after.score).toBe(original.score);
      expect(after.matchedBy).toBe(original.matchedBy);
    }
  });

  it("배운 대로 순서를 바꾼다 — 갈래를 누르면 자식이 올라온다", () => {
    if (branch === undefined) return;
    const before = [candidate(branch, 0.9), candidate(leaf, 0.85)];
    expect(ids(rerank(before, menus, LEARNED, context(), THRESHOLD))[0]).toBe(leaf);
  });

  it("마진보다 작은 차이로는 1위를 갈아치우지 않는다", () => {
    if (branch === undefined) return;
    const before = [candidate(branch, 0.9), candidate(leaf, 0.85)];
    const strict: RerankSettings = { ...LEARNED, margin: 10 };
    expect(ids(rerank(before, menus, strict, context(), THRESHOLD))).toEqual(ids(before));
  });

  it("★ 점수가 밴드 밖인 후보는 겨루지 않는다 — 뚜렷이 낮은 것을 끌어올리지 않는다", () => {
    if (branch === undefined) return;
    // 갈래가 1위지만 자식이 0.3이나 낮다. 좁은 밴드에서는 건드리지 않는다.
    const before = [candidate(branch, 0.9), candidate(leaf, 0.6)];
    const narrow: RerankSettings = { ...LEARNED, band: 0.05 };
    expect(ids(rerank(before, menus, narrow, context(), THRESHOLD))).toEqual(ids(before));
    // 넓은 밴드에서는 배운 대로 뒤집는다.
    expect(ids(rerank(before, menus, LEARNED, context(), THRESHOLD))[0]).toBe(leaf);
  });

  it("후보가 하나면 아무 일도 없다", () => {
    const before = [candidate(leaf, 0.9)];
    expect(rerank(before, menus, LEARNED, context(), THRESHOLD)).toEqual(before);
  });

  it("카탈로그에 없는 후보가 있어도 죽지 않는다", () => {
    const before = [candidate("없는메뉴", 0.9), candidate(leaf, 0.85)];
    expect(rerank(before, menus, LEARNED, context(), THRESHOLD)).toHaveLength(2);
  });

  it("원본 배열을 건드리지 않는다", () => {
    if (branch === undefined) return;
    const before = [candidate(branch, 0.9), candidate(leaf, 0.85)];
    const snapshot = ids(before);
    rerank(before, menus, LEARNED, context(), THRESHOLD);
    expect(ids(before)).toEqual(snapshot);
  });
});
