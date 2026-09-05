import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildBiasPhrases } from "../src/search/bias.js";
import type { MenuPrior } from "../src/search/prior.js";
import type { MenuCatalog } from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const CATALOG = JSON.parse(
  readFileSync(join(FIXTURES, "menus.json"), "utf8"),
) as MenuCatalog;

const settings = { ...DEFAULT_CONFIG.search.bias, enabled: true };
const none: MenuPrior = new Map();

describe("편향 목록 — 인식기에 카탈로그를 알려 준다 (M22)", () => {
  it("꺼져 있으면 아무것도 주지 않는다 — 기본값이 그것이다", () => {
    expect(buildBiasPhrases(CATALOG, none, DEFAULT_CONFIG.search.bias)).toEqual([]);
    expect(DEFAULT_CONFIG.search.bias.enabled).toBe(false);
  });

  it("메뉴 이름과 사람이 쓴 동의어를 원문 그대로 준다", () => {
    const phrases = buildBiasPhrases(CATALOG, none, settings).map((p) => p.phrase);
    const transfer = CATALOG.find((menu) => menu.id === "transfer.account")!;
    expect(phrases).toContain(transfer.label);
    for (const synonym of transfer.synonyms ?? []) {
      expect(phrases).toContain(synonym);
    }
  });

  it("정규화된 형태를 주지 않는다 — 사람은 그렇게 말하지 않는다", () => {
    const phrases = buildBiasPhrases(CATALOG, none, settings).map((p) => p.phrase);
    // 정규화는 공백을 지운다. 라벨에 공백이 있으면 원문에도 있어야 한다.
    const spaced = CATALOG.filter((menu) => menu.label.includes(" "));
    if (spaced.length > 0) expect(phrases).toContain(spaced[0]!.label);
  });

  it("같은 말을 두 번 넣지 않는다", () => {
    const phrases = buildBiasPhrases(CATALOG, none, settings).map((p) => p.phrase);
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it("개수 상한을 지킨다", () => {
    const capped = buildBiasPhrases(CATALOG, none, { ...settings, maxPhrases: 5 });
    expect(capped).toHaveLength(5);
  });

  it("자주 쓰는 메뉴가 먼저 들어간다 — 잘릴 때 남는 쪽이다", () => {
    const last = CATALOG[CATALOG.length - 1]!;
    const prior: MenuPrior = new Map([[last.id, 1]]);
    const capped = buildBiasPhrases(CATALOG, prior, { ...settings, maxPhrases: 1 });
    expect(capped[0]!.phrase).toBe(last.label);
  });

  it("자주 쓰는 말이 더 큰 무게를 받는다", () => {
    const first = CATALOG[0]!;
    const prior: MenuPrior = new Map([[first.id, 1]]);
    const withPrior = buildBiasPhrases(CATALOG, prior, settings);
    const without = buildBiasPhrases(CATALOG, none, settings);
    const boostOf = (list: typeof withPrior) =>
      list.find((p) => p.phrase === first.label)!.boost;
    expect(boostOf(withPrior)).toBeGreaterThan(boostOf(without));
  });

  it("★ 무게가 0~10을 벗어나지 않는다 — 브라우저가 던지는 범위다", () => {
    const wild = { ...settings, baseBoost: 50, priorBoost: 50 };
    for (const { boost } of buildBiasPhrases(CATALOG, none, wild)) {
      expect(boost).toBeGreaterThanOrEqual(0);
      expect(boost).toBeLessThanOrEqual(10);
    }
    const negative = { ...settings, baseBoost: -5, priorBoost: 0 };
    for (const { boost } of buildBiasPhrases(CATALOG, none, negative)) {
      expect(boost).toBeGreaterThanOrEqual(0);
    }
  });

  it("밖에서 온 말이 맨 앞에 온다 — 사용자가 실제로 쓴 직접 증거다", () => {
    const phrases = buildBiasPhrases(CATALOG, none, settings, ["떼가는 거"]);
    expect(phrases[0]!.phrase).toBe("떼가는 거");
    expect(phrases[0]!.boost).toBeGreaterThan(settings.baseBoost);
  });

  it("기록이 없어도 카탈로그 순서로 채운다 — 콜드 스타트에서도 빈손이 아니다", () => {
    const cold = buildBiasPhrases(CATALOG, none, { ...settings, maxPhrases: 3 });
    expect(cold).toHaveLength(3);
    expect(cold[0]!.phrase).toBe(CATALOG[0]!.label);
  });

  it("빈 카탈로그는 빈 목록이다", () => {
    expect(buildBiasPhrases([], none, settings)).toEqual([]);
  });
});
