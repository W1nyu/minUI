import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuCatalog } from "@minui/core";
import { describe, expect, it } from "vitest";
// 띄우는 곳만이 아니라 데이터가 있는 전부를 검사한다 — cold data도 깨지면 안 된다.
import { ALL_SITES as DEMO_SITES } from "../../demos/src/sites.js";

// build-catalog에서 가져오지 않는다 — 그 모듈은 불러오는 것만으로 빌드를 다시 돌린다.
const SITES = ["kbstar", "kbsec", "miraeasset", "shinhan", "kebhana"] as const;

/**
 * 빌드 산출물이 데모와 아귀가 맞는가.
 *
 * <p>빌더는 자기 안의 규칙만 검사한다. 카탈로그에서 메뉴가 빠졌을 때 그것을 가리키던
 * <b>데모의 온보딩 프리셋</b>이 끊어지는 것은 빌더가 알 수 없다. 실제로 갈래(상위 메뉴)를
 * 걷어냈을 때 프리셋 12개 중 7개가 없는 id를 가리키게 됐고, 그러면 첫 화면 카드가
 * 조용히 비거나 엉뚱한 순서로 채워진다 — 화면을 열어 보기 전에는 드러나지 않는다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const catalogs = new Map(
  SITES.map((site) => [
    site,
    JSON.parse(
      readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
    ) as MenuCatalog,
  ]),
);

describe("카탈로그", () => {
  it.each(SITES)("%s — 라벨이 겹치지 않는다", (site) => {
    const labels = catalogs.get(site)!.map((menu) => menu.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(SITES)("%s — 동의어가 붙은 메뉴가 실재한다", (site) => {
    const ids = new Set(catalogs.get(site)!.map((menu) => menu.id));
    const overrides = JSON.parse(
      readFileSync(join(HERE, `../catalogs/${site}.overrides.json`), "utf8"),
    ) as Record<string, unknown>;

    // 붙지 못한 override는 빌더가 리포트하지만 빌드를 막지는 않는다. 사람이 쓴 동의어가
    // 조용히 죽어 있는 상태로 굳는 것을 막는다.
    const dangling = Object.keys(overrides).filter(
      (key) => !key.startsWith("_") && !ids.has(key),
    );
    expect(dangling).toEqual([]);
  });
});

describe("데모 프리셋", () => {
  it.each(DEMO_SITES.map((site) => [site.name, site] as const))(
    "%s — 프리셋이 가리키는 메뉴가 전부 카탈로그에 있다",
    (_name, site) => {
      const ids = new Set(site.catalog.map((menu) => menu.id));
      const referenced = [
        ...site.presets.inquiry,
        ...site.presets.transfer,
        ...site.presets.invest,
      ];

      expect(referenced.filter((id) => !ids.has(id))).toEqual([]);
    },
  );
});
