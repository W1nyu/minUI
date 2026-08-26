import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  mergeNeural,
  type MenuCatalog,
  type NeuralMatch,
} from "@minui/core";
import {
  classifyLexicalSignal,
  overlap,
  type LexicalSignal,
} from "./eval-contamination.js";
import { menuDocument } from "../../services/matcher/src/document.js";
import { createEncoders } from "../../services/matcher/src/encoder.js";
import { cosineTopK, quantizeInt8, type VectorIndex } from "../../services/matcher/src/vectors.js";

/**
 * 신경망이 값을 하는가 — **사전 등록한 게이트로 판정한다** (M11 Task 14).
 *
 * <p>게이트는 사전 등록하되, 기존 회귀 세트와 의미 매칭 대조군을 같은 숫자로 뭉개지
 * 않는다. 문자 신호가 없는 `semantic-focus`에서 신경망의 추가 이득을 판정하고,
 * `lexical-support`는 일반 검색 경로가 퇴행하지 않는지 별도로 계속 보고한다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;

const GATE = { lift: 10, worseConfident: 0, p95Ms: 1200 };

/**
 * 튜닝과 판정을 가른다 (§12.6의 규칙).
 *
 * <p>`scoreFloor`는 **튜닝 세트의 부정 질의 분포에서 유도**하고, 판정은 검증 세트에서만
 * 한다. 같은 세트에서 값을 고르고 그 값으로 판정하면 그것은 측정이 아니다.
 */
const TUNE = new Set(["shinhan", "kbsec", "kebhana"]);
const HOLDOUT = new Set(["kbstar", "miraeasset"]);

interface Case { query: string; expect: string; menuId: string; site: string; source: string }
const fixture = JSON.parse(
  readFileSync(join(HERE, "../fixtures/neural-queries.json"), "utf8"),
) as { cases: Case[]; model: string };
const negatives = (
  JSON.parse(readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8")) as
    { negative: string[] }
).negative;

console.log(`
  신경망 검색 판정 — 사전 등록 게이트 (M11 §12.11)
  ${"─".repeat(70)}

  ① semantic-focus 1순위 정답  로컬 대비 **+${GATE.lift}%p 이상**
  ② 부정 질의 잘못된 확신     **늘지 않을 것** (하드 게이트)
  ③ p95 지연                  **${GATE.p95Ms}ms 이하**

  하나라도 못 넘으면 채택하지 않고, 못 넘었다는 사실을 그 자리에 적는다.
  ${"─".repeat(70)}
`);

const pipelines = new Map<string, { pipeline: SearchPipeline; known: Set<string> }>();
const { query: encoder, encodePassages, meta } = await createEncoders({
  modelDir: join(HERE, "../models"),
});
console.log(`  질의 세트  ${fixture.cases.length}건 (${fixture.model}이 씀) · 부정 ${negatives.length}건`);
console.log(`  검색 모델  ${meta.model}\n`);

interface Row {
  site: string;
  menuId: string;
  source: string;
  lexical: LexicalSignal;
  localTop: string | null;
  localOk: boolean;
  remote: NeuralMatch[];
}
const rows: Row[] = [];
const negRows: { site: string; localOk: boolean; remote: NeuralMatch[] }[] = [];
const latencies: number[] = [];

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;
  const ov = JSON.parse(
    readFileSync(join(HERE, `../catalogs/${site}.overrides.json`), "utf8"),
  ) as Record<string, { synonyms?: string[] }>;
  const shaped = catalog.map((m) => ({ ...m, synonyms: ov[m.id]?.synonyms ?? [] }));

  const index = new MenuIndex(shaped);
  const pipeline = new SearchPipeline(index, DEFAULT_CONFIG, NgramTfIdfProvider.build(index.documents()));
  const known = new Set(shaped.map((m) => m.id));
  const byId = new Map(shaped.map((menu) => [menu.id, menu]));

  const vecs = await encodePassages(
    shaped.map((m) => menuDocument({ label: m.label, synonyms: m.synonyms, path: m.path })),
  );
  const scale = new Float32Array(shaped.length);
  const data = new Int8Array(shaped.length * meta.dim);
  vecs.forEach((v, i) => { const q = quantizeInt8(v); scale[i] = q.scale; data.set(q.data, i * meta.dim); });
  const vindex: VectorIndex = { version: 1, dim: meta.dim, menuIds: shaped.map((m) => m.id), scale, data };

  const remoteFor = async (q: string): Promise<NeuralMatch[]> => {
    const t = Date.now();
    const v = await encoder.encode(q);
    const hits = cosineTopK(v, vindex, 20);
    latencies.push(Date.now() - t);
    return hits.map((h) => ({ menuId: h.menuId, score: h.score }));
  };

  pipelines.set(site, { pipeline, known });

  for (const c of fixture.cases.filter((x) => x.site === site)) {
    const local = pipeline.search(c.query);
    const menu = byId.get(c.menuId);
    if (!menu) throw new Error(`평가 정답을 현재 카탈로그에서 찾지 못했습니다: ${site} ${c.menuId}`);
    rows.push({
      site,
      menuId: c.menuId,
      source: c.source,
      lexical: classifyLexicalSignal(overlap(c.query, [menu.label, ...(menu.synonyms ?? [])])),
      localTop: local.status === "ok" ? (local.candidates[0]?.menuId ?? null) : null,
      localOk: local.status === "ok" && local.candidates[0]?.menuId === c.menuId,
      remote: await remoteFor(c.query),
    });
  }

  for (const q of negatives) {
    const local = pipeline.search(q);
    negRows.push({ site, localOk: local.status === "ok", remote: await remoteFor(q) });
  }
}

latencies.sort((a, b) => a - b);
const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

/*
 * ── 문턱 유도 — **고르는 값이 아니라 나오는 값이다.**
 *
 * 튜닝 세트의 부정 질의가 받은 원점수 최고값 위에 바닥을 놓는다. 천장은 그 세트
 * 정답들의 상위값. 검증 세트는 여기 쓰지 않는다.
 */
const tuneNegPeak = Math.max(
  ...negRows.filter((r) => TUNE.has(r.site)).map((r) => r.remote[0]?.score ?? 0),
);
const tunePos = rows
  .filter((r) => TUNE.has(r.site))
  .map((r) => r.remote.find((m) => m.menuId === r.menuId)?.score ?? 0)
  .filter((s) => s > 0)
  .sort((a, b) => a - b);
const ceiling = tunePos[Math.floor(tunePos.length * 0.9)] ?? 0.9;
const floor = Math.min(tuneNegPeak + 0.005, ceiling - 0.01);

const settings = { ...DEFAULT_CONFIG.search.neural, scoreFloor: floor, scoreCeiling: ceiling, weight: 1 };

console.log(`  ── 문턱 유도 (튜닝 세트 ${[...TUNE].join("·")}에서만)`);
console.log(`     부정 질의 최고 원점수  ${tuneNegPeak.toFixed(3)}`);
console.log(`     정답 원점수 90분위     ${ceiling.toFixed(3)}`);
console.log(`     → scoreFloor ${floor.toFixed(3)} · scoreCeiling ${ceiling.toFixed(3)} · weight 1.0
`);

function judge(subset: Set<string>, lexical?: LexicalSignal) {
  const rs = rows.filter((r) => subset.has(r.site) && (!lexical || r.lexical === lexical));
  const ns = negRows.filter((r) => subset.has(r.site));
  let local = 0, merged = 0, localConf = 0, mergedConf = 0;

  for (const r of rs) {
    if (r.localOk) local += 1;
    const p = pipelines.get(r.site)!;
    const m = mergeNeural([], r.remote, settings, p.known, "q");
    const best = r.localOk ? r.menuId : (m[0] && m[0].score >= DEFAULT_CONFIG.search.minConfidence ? m[0].menuId : r.localTop);
    if (best === r.menuId) merged += 1;
  }
  for (const r of ns) {
    if (r.localOk) localConf += 1;
    const p = pipelines.get(r.site)!;
    const m = mergeNeural([], r.remote, settings, p.known, "q");
    if (r.localOk || (m[0] && m[0].score >= DEFAULT_CONFIG.search.minConfidence)) mergedConf += 1;
  }
  return { n: rs.length, local, merged, negN: ns.length, localConf, mergedConf };
}

function printJudge(r: ReturnType<typeof judge>) {
  const pc = (x: number) => `${((x / r.n) * 100).toFixed(1)}%`;
  console.log(`     1순위 정답 (${r.n}건)      로컬 ${String(r.local).padStart(4)} ${pc(r.local).padStart(6)}   +원격 ${String(r.merged).padStart(4)} ${pc(r.merged).padStart(6)}`);
}

for (const [name, subset] of [["튜닝", TUNE], ["**검증**", HOLDOUT]] as const) {
  const all = judge(subset);
  const semantic = judge(subset, "semantic-focus");
  const lexical = judge(subset, "lexical-support");
  console.log(`  ── ${name} 세트 (${[...subset].join("·")})`);
  console.log("     전체 (회귀·의미가 섞인 운영 현황)");
  printJudge(all);
  console.log(`     잘못된 확신 (부정 ${all.negN}회)  로컬 ${String(all.localConf).padStart(4)}        +원격 ${String(all.mergedConf).padStart(4)}`);
  console.log("     층위별 1순위 (서로 합쳐 의미 효과로 읽지 않는다)");
  if (semantic.n > 0) {
    console.log("       semantic-focus");
    printJudge(semantic);
  }
  if (lexical.n > 0) {
    console.log("       lexical-support");
    printJudge(lexical);
  }
  console.log();
}

const h = judge(HOLDOUT, "semantic-focus");
const negativesHoldout = judge(HOLDOUT);
const lift = h.n === 0 ? Number.NEGATIVE_INFINITY : ((h.merged - h.local) / h.n) * 100;
const pass = [
  ["① 회수 (검증·semantic-focus)", lift >= GATE.lift, h.n === 0 ? "대조군 0건" : `${lift >= 0 ? "+" : ""}${lift.toFixed(1)}%p (기준 +${GATE.lift})`],
  ["② 거절 (검증)", negativesHoldout.mergedConf <= negativesHoldout.localConf, `${negativesHoldout.localConf} → ${negativesHoldout.mergedConf}건`],
  ["③ 지연", p95 <= GATE.p95Ms, `${p95}ms (기준 ${GATE.p95Ms})`],
] as const;

console.log(`  ${"─".repeat(70)}`);
for (const [name, ok, detail] of pass) console.log(`  ${ok ? "통과" : "미달"}  ${name}  ${detail}`);

const allPass = pass.every(([, ok]) => ok);
console.log(`
  ${allPass ? "**채택**" : "**미달 — enabled: false로 남긴다. 게이트를 옮기지 않는다.**"}
`);
if (!allPass) process.exitCode = 1;
