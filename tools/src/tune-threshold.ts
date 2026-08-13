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
 * 임계값을 내리면 무엇을 얻고 무엇을 잃는가.
 *
 * <p>0번 측정에서 놓친 19건 중 7건은 <b>정답이 이미 1위인데 점수가 낮아 되물은</b> 것이었다.
 * 임계값만 내려도 살아난다. 하지만 정답이 있는 질의만으로 재면 내릴수록 좋아 보이기만 한다 —
 * 얻는 쪽만 세고 잃는 쪽을 안 세기 때문이다.
 *
 * <p>그래서 두 세트를 함께 돌린다.
 * <ul>
 *   <li><b>정답 세트</b> — 되물으면 실패. 낮은 임계값이 유리하다
 *   <li><b>답 없는 세트</b> — 되물어야 정답. 높은 임계값이 유리하다
 * </ul>
 *
 * <p>둘을 같은 표에 놓아야 어디가 무릎인지 보인다. 한쪽만 보고 고른 값은 튜닝이 아니라
 * 자기 좋은 쪽으로 자를 옮긴 것이다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;

/** 동의어와 질의를 같은 자리에서 쓴 사이트. 합계에서 뺀다. */
const SELF_SCORED = new Set<string>(["kebhana"]);

interface Case {
  query: string;
  expect: string;
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
) as { sites: Record<string, Case[]>; negative: string[] };

const THRESHOLDS = [0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2];

interface Loaded {
  site: string;
  catalog: MenuCatalog;
  index: MenuIndex;
  embedding: NgramTfIdfProvider;
}

const loaded: Loaded[] = SITES.map((site) => {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;
  const index = new MenuIndex(catalog);
  return { site, catalog, index, embedding: NgramTfIdfProvider.build(index.documents()) };
});

interface Result {
  threshold: number;
  /** 정답 세트: 1순위가 정답. */
  top1: number;
  /** 정답 세트: 후보 3개 안에 정답. */
  top3: number;
  positives: number;
  /** 답 없는 세트: 되물었다 = 옳게 굴었다. */
  reprompted: number;
  negatives: number;
  /** 답 없는 질의인데 후보를 내민 것들. 무엇을 내밀었는지 함께 본다. */
  falseConfident: { site: string; query: string; menu: string; score: number }[];
}

/**
 * @param highRiskFloor 자금이 움직이는 메뉴(riskLevel: high)를 후보로 내밀 최소 확신.
 *   생략하면 위험도를 구분하지 않는다(현재 동작).
 */
function run(threshold: number, highRiskFloor?: number): Result {
  const config = resolveConfig({ search: { minConfidence: threshold } });
  let top1 = 0;
  let top3 = 0;
  let positives = 0;
  let reprompted = 0;
  let negatives = 0;
  const falseConfident: Result["falseConfident"] = [];

  for (const entry of loaded) {
    const pipeline = new SearchPipeline(entry.index, config, entry.embedding);
    const byId = new Map(entry.catalog.map((menu) => [menu.id, menu]));
    const skip = SELF_SCORED.has(entry.site);

    /* 위험한 메뉴는 더 확실할 때만 내민다. 전부 걸러지면 되묻는 것과 같다. */
    const sift = (outcome: ReturnType<SearchPipeline["search"]>) => {
      if (highRiskFloor === undefined || outcome.status !== "ok") return outcome;
      const kept = outcome.candidates.filter(
        (c) => byId.get(c.menuId)?.riskLevel !== "high" || c.score >= highRiskFloor,
      );
      if (kept.length === 0) return { status: "unclear" as const, query: outcome.query, prompt: "", choices: [] };
      return { ...outcome, candidates: kept };
    };

    for (const testCase of querySet.sites[entry.site] ?? []) {
      if (skip) continue;
      positives += 1;
      const outcome = sift(pipeline.search(testCase.query));
      if (outcome.status !== "ok") continue;
      const labels = outcome.candidates.map((c) => byId.get(c.menuId)?.label ?? "");
      if (labels[0] === testCase.expect) top1 += 1;
      else if (labels.includes(testCase.expect)) top3 += 1;
    }

    for (const query of querySet.negative) {
      if (skip) continue;
      negatives += 1;
      const outcome = sift(pipeline.search(query));
      if (outcome.status !== "ok") {
        reprompted += 1;
        continue;
      }
      const first = outcome.candidates[0]!;
      falseConfident.push({
        site: entry.site,
        query,
        menu: byId.get(first.menuId)?.label ?? first.menuId,
        score: first.score,
      });
    }
  }

  return { threshold, top1, top3, positives, reprompted, negatives, falseConfident };
}

const results = THRESHOLDS.map((t) => run(t));

/** 일반 메뉴는 낮게, 자금이 움직이는 메뉴는 현재값(0.55) 그대로. */
const risked = [0.45, 0.4, 0.35, 0.3].map((t) => ({
  threshold: t,
  result: run(t, DEFAULT_CONFIG.search.minConfidence),
}));

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(0)}%`;

console.log(
  `\n  임계값을 바꾸면 — 정답 세트 ${results[0]!.positives}문항 · 답 없는 세트 ${results[0]!.negatives}문항\n` +
    `  (하나은행은 동의어와 질의를 같은 자리에서 써서 뺐다)\n`,
);
console.log(
  `  ${"임계값".padEnd(8)}${"1순위 정답".padStart(12)}${"후보 3개 안".padStart(13)}` +
    `${"옳게 되물음".padStart(13)}${"잘못된 확신".padStart(13)}`,
);

for (const r of results) {
  const mark = r.threshold === DEFAULT_CONFIG.search.minConfidence ? " ← 현재" : "";
  console.log(
    `  ${r.threshold.toFixed(2).padEnd(8)}` +
      `${`${r.top1}/${r.positives} ${pct(r.top1, r.positives)}`.padStart(12)}` +
      `${`${r.top1 + r.top3} ${pct(r.top1 + r.top3, r.positives)}`.padStart(13)}` +
      `${`${r.reprompted}/${r.negatives} ${pct(r.reprompted, r.negatives)}`.padStart(13)}` +
      `${`${r.falseConfident.length}건`.padStart(13)}${mark}`,
  );
}

console.log(
  `\n  ── 위험도로 나누면 (일반 메뉴만 내리고, riskLevel:high는 ${DEFAULT_CONFIG.search.minConfidence} 유지)\n`,
);
console.log(
  `  ${"일반 임계값".padEnd(12)}${"1순위 정답".padStart(12)}${"후보 3개 안".padStart(13)}` +
    `${"옳게 되물음".padStart(13)}${"잘못된 확신".padStart(13)}`,
);
for (const { threshold, result: r } of risked) {
  console.log(
    `  ${threshold.toFixed(2).padEnd(12)}` +
      `${`${r.top1}/${r.positives} ${pct(r.top1, r.positives)}`.padStart(12)}` +
      `${`${r.top1 + r.top3} ${pct(r.top1 + r.top3, r.positives)}`.padStart(13)}` +
      `${`${r.reprompted}/${r.negatives} ${pct(r.reprompted, r.negatives)}`.padStart(13)}` +
      `${`${r.falseConfident.length}건`.padStart(13)}`,
  );
}

console.log("\n  ── 답 없는 질의에 무엇을 내미는가 (임계값별 첫 3건)\n");
for (const r of results) {
  if (r.falseConfident.length === 0) continue;
  const shown = r.falseConfident
    .slice(0, 3)
    .map((f) => `"${f.query}" → ${f.menu} (${f.score.toFixed(2)}, ${f.site})`);
  console.log(`  ${r.threshold.toFixed(2)}  ${shown.join("  ·  ")}`);
}
console.log();
