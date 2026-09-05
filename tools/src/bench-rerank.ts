import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  type FeatureName,
  type MinUIConfig,
} from "@minui/core";
import { catalogFor, isAnswer, isRecognized, loadCorpus } from "./corpus.js";
import { HOLDOUT_SITES, HOLDOUT_SPEAKER, buildSplit } from "./rerank-data.js";

/**
 * 학습된 재순위가 값을 하는가 — 사전 등록 게이트 (M23).
 *
 * <p>판정은 <b>두 축이 겹치는 홀드아웃</b>에서 한다 — 동의어를 실패 보고 고친 적 없는
 * 사이트(KB국민·미래에셋)와, 학습에 쓰지 않은 화자(B1)가 동시에 성립하는 줄.
 *
 * <p>학습 세트 수치도 나란히 찍는다. <b>거기서만 오르면 외운 것이고,</b> 그 사실을
 * §16에 그대로 적는다.
 *
 * <pre>
 *   pnpm --filter tools fit:rerank    # 먼저
 *   pnpm --filter tools bench:rerank
 * </pre>
 */

const WEIGHTS = join(dirname(fileURLToPath(import.meta.url)), "../out/rerank.json");

/** **측정 전에 못 박은 기준.** 고치려면 왜 고치는지를 기획안에 먼저 적는다. */
const GATE = {
  /** 홀드아웃에서 1순위 정답이 이만큼(%p) 올라야 한다. */
  top1Lift: 3,
  /** 답 없는 질의를 자신 있게 여는 것이 늘면 안 된다. */
  worseConfident: 0,
  /** 정확 매칭이 밀려난 사례. */
  exactDemoted: 0,
  /** 질의당 추가 지연 p95 (ms). 내적 하나라 넉넉하다. */
  p95Ms: 10,
} as const;

interface Score {
  top1: number;
  answered: number;
  elapsed: number[];
  moved: string[];
}

function withWeights(weights: Partial<Record<FeatureName, number>>): MinUIConfig {
  return {
    ...DEFAULT_CONFIG,
    search: {
      ...DEFAULT_CONFIG.search,
      rerank: {
        ...DEFAULT_CONFIG.search.rerank,
        enabled: true,
        weights,
        band: Number(process.env["MINUI_RERANK_BAND"] ?? DEFAULT_CONFIG.search.rerank.band),
        margin: Number(process.env["MINUI_RERANK_MARGIN"] ?? DEFAULT_CONFIG.search.rerank.margin),
      },
    },
  };
}

const pipes = new Map<string, SearchPipeline>();

function pipeFor(site: string, config: MinUIConfig, key: string): SearchPipeline | null {
  const cacheKey = `${site}|${key}`;
  const cached = pipes.get(cacheKey);
  if (cached) return cached;
  const catalog = catalogFor(site);
  if (!catalog) return null;
  const index = new MenuIndex(catalog);
  const pipeline = new SearchPipeline(index, config, NgramTfIdfProvider.build(index.documents()));
  pipes.set(cacheKey, pipeline);
  return pipeline;
}

interface Case {
  site: string;
  query: string;
  expect: string;
}

function run(cases: readonly Case[], config: MinUIConfig, key: string): Score {
  const score: Score = { top1: 0, answered: 0, elapsed: [], moved: [] };

  // 색인을 먼저 짓는다 — 첫 질의에 그 비용이 얹히면 지연 수치가 거짓이 된다.
  for (const site of new Set(cases.map((c) => c.site))) pipeFor(site, config, key)?.search("잔액");

  for (const testCase of cases) {
    const pipeline = pipeFor(testCase.site, config, key);
    if (!pipeline) continue;
    score.answered += 1;

    const started = performance.now();
    const outcome = pipeline.search(testCase.query);
    score.elapsed.push(performance.now() - started);

    if (outcome.status !== "ok") continue;
    if (isAnswer(testCase.site, outcome.candidates[0]!.menuId, testCase.expect)) score.top1 += 1;
  }

  return score;
}

function negativeHits(config: MinUIConfig, key: string, negatives: readonly string[]): number {
  let hits = 0;
  for (const site of [...HOLDOUT_SITES, "shinhan", "kbsec", "kebhana"]) {
    const pipeline = pipeFor(site, config, key);
    if (!pipeline) continue;
    for (const query of negatives) {
      if (pipeline.search(query).status === "ok") hits += 1;
    }
  }
  return hits;
}

/** 정확 매칭이 밀려난 적이 있는가. 있으면 그 자체로 미달이다. */
function exactDemoted(cases: readonly Case[], config: MinUIConfig, key: string): number {
  let count = 0;
  for (const testCase of cases) {
    const before = pipeFor(testCase.site, DEFAULT_CONFIG, "off")?.search(testCase.query);
    const after = pipeFor(testCase.site, config, key)?.search(testCase.query);
    if (before?.status !== "ok" || after?.status !== "ok") continue;
    if (before.candidates[0]!.matchedBy !== "exact") continue;
    if (after.candidates[0]!.menuId !== before.candidates[0]!.menuId) count += 1;
  }
  return count;
}

function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

/** 홀드아웃 질의를 다시 만든다 — `rerank-data`의 분할과 <b>같은 규칙</b>이어야 한다. */
function holdoutCases(): Case[] {
  const cases: Case[] = [];
  const corpus = loadCorpus();
  for (const row of corpus?.rows ?? []) {
    if (!isRecognized(row) || row.expect === undefined) continue;
    if (!(HOLDOUT_SITES as readonly string[]).includes(row.site)) continue;
    if (row.speaker !== HOLDOUT_SPEAKER) continue;
    cases.push({ site: row.site, query: row.heard, expect: row.expect });
  }

  const siteQueries = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/site-queries.json"), "utf8"),
  ) as { sites: Record<string, { query: string; expect: string }[]>; negative: string[] };
  for (const site of HOLDOUT_SITES) {
    for (const testCase of siteQueries.sites[site] ?? []) {
      cases.push({ site, query: testCase.query, expect: testCase.expect });
    }
  }
  return cases;
}

function main(): void {
  if (!existsSync(WEIGHTS)) {
    console.log("\n  가중치가 없다 — pnpm --filter tools fit:rerank 를 먼저 돌린다.\n");
    process.exitCode = 1;
    return;
  }

  const weights = JSON.parse(readFileSync(WEIGHTS, "utf8")) as Partial<Record<FeatureName, number>>;
  const on = withWeights(weights);
  const split = buildSplit();

  const trainCases: Case[] = split.train.map((s) => ({ site: s.site, query: s.query, expect: s.expect }));
  const holdCases = holdoutCases();

  console.log("\n── 학습된 후보 재순위 (M23) ────────────────────────────────\n");
  console.log(`  홀드아웃 = 사이트 {${HOLDOUT_SITES.join(" · ")}} ∩ 화자 ${HOLDOUT_SPEAKER}, 그리고 그 사이트의 텍스트 세트`);
  console.log(`  학습 ${trainCases.length}문항 · 홀드아웃 ${holdCases.length}문항\n`);

  const rows: [string, readonly Case[]][] = [
    ["학습 (부풀려져 있다)", trainCases],
    ["홀드아웃 (판정)", holdCases],
  ];

  let liftHoldout = 0;
  console.log("  세트                    재순위 없이      재순위 넣고      차이");
  for (const [label, cases] of rows) {
    const before = run(cases, DEFAULT_CONFIG, "off");
    const after = run(cases, on, "on");
    const pct = (s: Score) => (s.answered === 0 ? 0 : (100 * s.top1) / s.answered);
    const lift = pct(after) - pct(before);
    if (label.startsWith("홀드아웃")) liftHoldout = lift;
    console.log(
      `  ${label.padEnd(22)} ${before.top1}/${before.answered} ${pct(before).toFixed(1).padStart(5)}%   ` +
        `${after.top1}/${after.answered} ${pct(after).toFixed(1).padStart(5)}%   ` +
        `${lift >= 0 ? "+" : ""}${lift.toFixed(1)}%p`,
    );
  }

  const negBefore = negativeHits(DEFAULT_CONFIG, "off", split.negatives);
  const negAfter = negativeHits(on, "on", split.negatives);
  const demoted = exactDemoted([...trainCases, ...holdCases], on, "on");
  const latency =
    p95(run(holdCases, on, "on").elapsed) - p95(run(holdCases, DEFAULT_CONFIG, "off").elapsed);

  console.log(`\n── 사전 등록 게이트 판정 (홀드아웃) ────────────────────\n`);
  const line = (ok: boolean, text: string) => console.log(`    ${ok ? "통과" : "미달"}  ${text}`);
  line(liftHoldout >= GATE.top1Lift, `1순위 상승 ${liftHoldout.toFixed(1)}%p  (기준 +${GATE.top1Lift}%p)`);
  line(
    negAfter - negBefore <= GATE.worseConfident,
    `답 없는 질의 잘못된 확신 ${negBefore} → ${negAfter}  (증가 ${negAfter - negBefore}, 기준 ${GATE.worseConfident})`,
  );
  line(demoted <= GATE.exactDemoted, `정확 매칭이 밀려난 사례 ${demoted}건  (기준 ${GATE.exactDemoted})`);
  line(latency <= GATE.p95Ms, `추가 지연 p95 ${latency.toFixed(2)}ms  (기준 ${GATE.p95Ms}ms)`);

  const passed =
    liftHoldout >= GATE.top1Lift &&
    negAfter - negBefore <= GATE.worseConfident &&
    demoted <= GATE.exactDemoted &&
    latency <= GATE.p95Ms;

  console.log(
    passed
      ? "\n  게이트 통과 — config.ts의 search.rerank 에 가중치를 싣고 켠다.\n"
      : "\n  게이트 미달 — 켜지 않는다. 수치를 docs/기획안.md §16에 적는다.\n",
  );

  const step = holdCases.length === 0 ? 0 : 100 / holdCases.length;
  console.log(
    `  표본 주의: 홀드아웃 ${holdCases.length}문항이라 한 문항이 ${step.toFixed(1)}%p다.\n` +
      `  기준 +${GATE.top1Lift}%p는 약 ${Math.ceil((GATE.top1Lift / step) || 0)}문항에 해당한다 — 이 표본에서 그 차이는 잡음과 구별하기 어렵다.\n`,
  );
}

main();
