import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  type MenuCatalog,
  type MenuItem,
} from "@minui/core";

/**
 * 사이트별 검색 정확도.
 *
 * <p>동의어 사전의 효과를 재는 것이 목적이다. 같은 질의를 세 가지 구성으로 돌린다.
 * <ol>
 *   <li><b>라벨만</b> — 동의어 없이 메뉴 이름만
 *   <li><b>+ 자동(사전)</b> — 용어 사전으로 만든 구어 문구
 *   <li><b>+ 수작업</b> — 사람이 붙인 것까지 (현재 카탈로그)
 * </ol>
 *
 * <p>질의는 사전을 만들기 전에 썼고 이후 고치지 않았다. 그래도 같은 사람이 둘 다 만든
 * 이상 실사용 추정치는 아니다 — M4에서 적어 둔 것과 같은 한계다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset"] as const;

interface Case {
  query: string;
  /** 도달해야 하는 메뉴의 라벨. id는 개편에 끊어지므로 라벨로 적는다. */
  expect: string;
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
) as { sites: Record<string, Case[]> };

type Mode = "라벨만" | "+ 자동(사전)" | "+ 수작업" | "수작업만";

function shape(catalog: MenuCatalog, mode: Mode, handIds: Set<string>): MenuCatalog {
  return catalog.map((menu): MenuItem => {
    if (mode === "+ 수작업") return menu;
    // 수작업만: 사전이 만든 자동 동의어를 지우고 사람이 붙인 것만 남긴다.
    if (mode === "수작업만") return handIds.has(menu.id) ? menu : { ...menu, synonyms: [] };
    if (mode === "라벨만") return { ...menu, synonyms: [] };
    // 자동만: 수작업으로 붙인 메뉴는 동의어를 지워 자동 생성분만 남긴다.
    return handIds.has(menu.id) ? { ...menu, synonyms: [] } : menu;
  });
}

function run(catalog: MenuCatalog, cases: Case[]) {
  const index = new MenuIndex(catalog);
  const pipeline = new SearchPipeline(
    index,
    DEFAULT_CONFIG,
    NgramTfIdfProvider.build(index.documents()),
  );

  let top1 = 0;
  let top3 = 0;
  let unclear = 0;
  const misses: string[] = [];

  for (const testCase of cases) {
    const result = pipeline.search(testCase.query);
    if (result.status === "unclear") {
      unclear += 1;
      misses.push(`되묻기  "${testCase.query}" → ${testCase.expect}`);
      continue;
    }

    const labels = result.candidates.map(
      (candidate) => catalog.find((m) => m.id === candidate.menuId)?.label ?? "",
    );
    if (labels[0] === testCase.expect) top1 += 1;
    else if (labels.includes(testCase.expect)) {
      top3 += 1;
      misses.push(`2~3순위 "${testCase.query}" 1순위=${labels[0]} → ${testCase.expect}`);
    } else {
      misses.push(`오답    "${testCase.query}" → ${labels[0]} (정답: ${testCase.expect})`);
    }
  }

  return { top1, top3, unclear, total: cases.length, misses };
}

const rows: { site: string; mode: Mode; top1: number; top3: number; total: number }[] = [];
const detail: string[] = [];

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;

  const overridesPath = join(HERE, `../catalogs/${site}.overrides.json`);
  const handIds = new Set(
    Object.keys(JSON.parse(readFileSync(overridesPath, "utf8")) as object).filter(
      (key) => !key.startsWith("_"),
    ),
  );

  const cases = querySet.sites[site] ?? [];

  for (const mode of ["라벨만", "+ 자동(사전)", "수작업만", "+ 수작업"] as Mode[]) {
    const result = run(shape(catalog, mode, handIds), cases);
    rows.push({ site, mode, top1: result.top1, top3: result.top3, total: result.total });
    if (mode === "+ 수작업" && result.misses.length > 0) {
      detail.push(`\n  ${site} 놓친 것 ${result.misses.length}건`);
      for (const miss of result.misses) detail.push(`    ${miss}`);
    }
  }
}

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(0)}%`;

console.log(`\n  1회 질의 정확 매칭 (괄호는 후보 3개 안에 포함)\n`);
console.log(
  `  ${"사이트".padEnd(12)}${"라벨만".padStart(13)}${"+자동(사전)".padStart(15)}${"수작업만".padStart(14)}${"수작업+사전".padStart(15)}`,
);

for (const site of SITES) {
  const bySite = rows.filter((r) => r.site === site);
  const cell = (mode: Mode) => {
    const r = bySite.find((x) => x.mode === mode)!;
    return `${pct(r.top1, r.total)} (${pct(r.top1 + r.top3, r.total)})`;
  };
  console.log(
    `  ${site.padEnd(12)}${cell("라벨만").padStart(13)}${cell("+ 자동(사전)").padStart(15)}${cell("수작업만").padStart(14)}${cell("+ 수작업").padStart(15)}`,
  );
}

const sum = (mode: Mode) => {
  const r = rows.filter((x) => x.mode === mode);
  const t1 = r.reduce((n, x) => n + x.top1, 0);
  const total = r.reduce((n, x) => n + x.total, 0);
  return `${t1}/${total} ${pct(t1, total)}`;
};

console.log(
  `\n  전체  라벨만 ${sum("라벨만")}  ·  + 자동 ${sum("+ 자동(사전)")}  ·  + 수작업 ${sum("+ 수작업")}`,
);

for (const line of detail) console.log(line);
console.log();
