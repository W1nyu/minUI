import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  resolveConfig,
  type MenuCatalog,
} from "@minui/core";

/**
 * 검색 파라미터를 **나눠서** 고른다 — 튜닝 세트와 검증 세트를 분리한다.
 *
 * <p>이 프로젝트의 모든 정확도 수치에는 같은 흠이 있었다. 질의도 내가 쓰고 동의어도 내가
 * 붙였고, 나중에는 어느 질의가 실패했는지 보고 나서 동의어를 붙였다. 그렇게 얻은 숫자는
 * 상한선이지 추정치가 아니다.
 *
 * <p>지금은 나눌 수 있다. 실패를 보고 동의어를 고친 곳은 신한·KB증권·하나 셋뿐이고,
 * <b>KB국민은행과 미래에셋은 손대지 않았다</b>(서비스 대상에서 빠져 cold data로 남았다).
 * 그래서 이렇게 한다.
 *
 * <ul>
 *   <li><b>튜닝 세트</b> — 신한·KB증권·하나 (45문항). 여기서 파라미터를 고른다
 *   <li><b>검증 세트</b> — KB국민·미래에셋 (30문항). <b>고른 뒤에 한 번만 본다</b>
 * </ul>
 *
 * <p>검증 세트의 점수가 오르면 그 파라미터는 질의에 맞춘 것이 아니라 실제로 나은 것이다.
 * 안 오르면 튜닝 세트에서 오른 만큼은 과적합이었다는 뜻이고, 그 사실을 그대로 적는다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const TUNE_SITES = ["shinhan", "kbsec", "kebhana"] as const;
const HOLDOUT_SITES = ["kbstar", "miraeasset"] as const;

interface Case {
  query: string;
  expect: string;
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
) as { sites: Record<string, Case[]>; negative: string[] };

interface Loaded {
  site: string;
  catalog: MenuCatalog;
  index: MenuIndex;
  embedding: NgramTfIdfProvider;
}

const cache = new Map<string, Loaded>();
function load(site: string): Loaded {
  const hit = cache.get(site);
  if (hit) return hit;
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;
  const index = new MenuIndex(catalog);
  const entry = {
    site,
    catalog,
    index,
    embedding: NgramTfIdfProvider.build(index.documents()),
  };
  cache.set(site, entry);
  return entry;
}

interface Score {
  top1: number;
  top3: number;
  positives: number;
  reprompted: number;
  negatives: number;
}

function evaluate(sites: readonly string[], semanticWeight: number, floor: number): Score {
  const config = resolveConfig({ search: { semanticWeight, termSpecificityFloor: floor } });
  const score: Score = {
    top1: 0,
    top3: 0,
    positives: 0,
    reprompted: 0,
    negatives: 0,
  };

  for (const site of sites) {
    const entry = load(site);
    const pipeline = new SearchPipeline(entry.index, config, entry.embedding);
    const byId = new Map(entry.catalog.map((menu) => [menu.id, menu]));

    for (const testCase of querySet.sites[site] ?? []) {
      score.positives += 1;
      const outcome = pipeline.search(testCase.query);
      if (outcome.status !== "ok") continue;
      const labels = outcome.candidates.map((c) => byId.get(c.menuId)?.label ?? "");
      if (labels[0] === testCase.expect) score.top1 += 1;
      else if (labels.includes(testCase.expect)) score.top3 += 1;
    }

    for (const query of querySet.negative) {
      score.negatives += 1;
      if (pipeline.search(query).status !== "ok") score.reprompted += 1;
    }
  }

  return score;
}

const SEMANTIC = [1.0, 0.85, 0.7, 0.55];
const FLOOR = [0.8, 0.65, 0.5, 0.35];

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(0)}%`;

/**
 * 하나의 수로 줄여야 순위를 매길 수 있다. 정답을 맞히는 것과 모르는 것을 모른다고 하는 것을
 * **같은 무게로** 둔다 — 어느 한쪽만 보면 그쪽으로만 치우친 값이 뽑힌다.
 */
function combined(score: Score): number {
  return score.top1 / score.positives + score.reprompted / score.negatives;
}

console.log(`\n  튜닝 세트 — ${TUNE_SITES.join(" · ")} (실패를 보고 동의어를 고친 곳)\n`);
console.log(
  `  ${"semantic".padEnd(10)}${"floor".padEnd(8)}${"1순위".padStart(10)}` +
    `${"후보3개".padStart(10)}${"옳게 되물음".padStart(13)}${"합".padStart(8)}`,
);

interface Candidate {
  semanticWeight: number;
  floor: number;
  score: Score;
}

const grid: Candidate[] = [];
for (const semanticWeight of SEMANTIC) {
  for (const floor of FLOOR) {
    const score = evaluate(TUNE_SITES, semanticWeight, floor);
    grid.push({ semanticWeight, floor, score });
  }
}

const current = grid.find(
  (c) =>
    c.semanticWeight === DEFAULT_CONFIG.search.semanticWeight &&
    c.floor === DEFAULT_CONFIG.search.termSpecificityFloor,
)!;

const ranked = [...grid].sort((a, b) => combined(b.score) - combined(a.score));

for (const c of ranked) {
  const isCurrent = c === current;
  console.log(
    `  ${c.semanticWeight.toFixed(2).padEnd(10)}${c.floor.toFixed(2).padEnd(8)}` +
      `${pct(c.score.top1, c.score.positives).padStart(10)}` +
      `${pct(c.score.top1 + c.score.top3, c.score.positives).padStart(10)}` +
      `${pct(c.score.reprompted, c.score.negatives).padStart(13)}` +
      `${combined(c.score).toFixed(3).padStart(8)}${isCurrent ? "  ← 지금" : ""}`,
  );
}

const best = ranked[0]!;

console.log(
  `\n  튜닝 세트가 고른 값: semanticWeight ${best.semanticWeight} · floor ${best.floor}\n`,
);

console.log(`  검증 세트 — ${HOLDOUT_SITES.join(" · ")} (손대지 않은 곳). 여기서 한 번만 본다\n`);
console.log(
  `  ${"".padEnd(18)}${"1순위".padStart(10)}${"후보3개".padStart(10)}${"옳게 되물음".padStart(13)}`,
);

const holdoutNow = evaluate(
  HOLDOUT_SITES,
  DEFAULT_CONFIG.search.semanticWeight,
  DEFAULT_CONFIG.search.termSpecificityFloor,
);
const holdoutBest = evaluate(HOLDOUT_SITES, best.semanticWeight, best.floor);

const row = (name: string, s: Score) =>
  `  ${name.padEnd(18)}${`${s.top1}/${s.positives} ${pct(s.top1, s.positives)}`.padStart(10)}` +
  `${pct(s.top1 + s.top3, s.positives).padStart(10)}` +
  `${pct(s.reprompted, s.negatives).padStart(13)}`;

console.log(row("지금 값", holdoutNow));
console.log(row("고른 값", holdoutBest));

const delta = holdoutBest.top1 - holdoutNow.top1;
console.log(
  `\n  ${
    delta > 0
      ? `검증 세트에서도 ${delta}건 올랐다. 질의에 맞춘 것이 아니라 실제로 나은 값이다.`
      : delta === 0
        ? "검증 세트는 그대로다. 튜닝 세트에서 오른 만큼은 그 세트에만 해당한다."
        : `검증 세트에서 ${-delta}건 내려갔다. **과적합이다.** 값을 바꾸면 안 된다.`
  }\n`,
);
