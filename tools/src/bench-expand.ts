import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  normalize,
  type MenuCatalog,
  type SearchCandidate,
} from "@minui/core";

/**
 * 용어 사전을 **질의 쪽에** 붙이면 나아지는가.
 *
 * <p>전에 한 번 실패한 적이 있다. 그때는 사전으로 <b>라벨을 부풀렸다</b> — "자동이체 해지"에
 * "자동이체 그만두기"를 동의어로 붙이는 식이었고, 색인이 두 배가 되면서 기여는 0이었다.
 * 실패한 이유는 분명하다. 사용자가 쓰는 말이 라벨에 없으면 라벨을 아무리 변형해도
 * 그 말이 생기지 않는다.
 *
 * <p>반대 방향은 아직 안 해 봤다. <b>사용자의 말을 사이트의 말로 바꿔서</b> 다시 찾는 것이다.
 * "돈 빼려고"에 "출금"을 얹어 한 번 더 찾는다. 색인은 그대로고 질의만 몇 갈래로 늘어난다.
 *
 * <p>여기서는 코어를 고치지 않고 <b>흉내만 낸다.</b> 같은 파이프라인을 변형된 질의마다
 * 돌리고 메뉴별 최고점을 취한다. 이득이 있으면 그때 코어에 넣는다 —
 * 없으면 코드가 늘지 않은 채로 끝난다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;
const SELF_SCORED = new Set<string>(["kebhana"]);

interface Case {
  query: string;
  expect: string;
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
) as { sites: Record<string, Case[]>; negative: string[] };

const glossary = JSON.parse(
  readFileSync(join(HERE, "../catalogs/glossary.json"), "utf8"),
) as Record<string, string[]>;

/** 구어 → 사이트 용어. 사전을 뒤집어 만든다. 긴 표현부터 봐야 "돈 빼기"가 "돈"에 안 먹힌다. */
const COLLOQUIAL: { spoken: string; formal: string }[] = [];
for (const [formal, spokenList] of Object.entries(glossary)) {
  if (formal.startsWith("_")) continue;
  for (const spoken of spokenList) {
    COLLOQUIAL.push({ spoken: normalize(spoken), formal: normalize(formal) });
  }
}
COLLOQUIAL.sort((a, b) => b.spoken.length - a.spoken.length);

/**
 * 질의를 사이트의 말로 바꾼 변형들.
 *
 * <p>바꾼 것과 <b>덧붙인 것</b>을 모두 낸다. 바꾸기만 하면 원래 말이 사라져서,
 * 라벨에 구어가 이미 있는 메뉴를 놓친다.
 */
function expand(normalized: string, limit = 4): string[] {
  const out: string[] = [];
  for (const { spoken, formal } of COLLOQUIAL) {
    if (spoken.length < 2 || !normalized.includes(spoken)) continue;
    if (normalized.includes(formal)) continue; // 이미 그 말을 썼다
    out.push(normalized.replace(spoken, formal));
    out.push(`${normalized}${formal}`);
    if (out.length >= limit * 2) break;
  }
  return [...new Set(out)];
}

interface Outcome {
  status: "ok" | "unclear";
  candidates: SearchCandidate[];
}

function searchExpanded(
  pipeline: SearchPipeline,
  open: SearchPipeline,
  query: string,
  useExpansion: boolean,
): Outcome {
  const base = pipeline.search(query);
  if (!useExpansion) {
    return base.status === "ok"
      ? { status: "ok", candidates: base.candidates }
      : { status: "unclear", candidates: [] };
  }

  const normalized = normalize(query);
  const variants = expand(normalized);

  // 메뉴별 최고점을 모은다. 원본 질의의 점수가 우선이고, 변형은 그것을 넘을 때만 이긴다.
  const best = new Map<string, SearchCandidate>();
  const collect = (outcome: ReturnType<SearchPipeline["search"]>) => {
    if (outcome.status !== "ok") return;
    for (const candidate of outcome.candidates) {
      const prev = best.get(candidate.menuId);
      if (!prev || candidate.score > prev.score) best.set(candidate.menuId, candidate);
    }
  };

  collect(open.search(query));
  for (const variant of variants) collect(open.search(variant));

  const merged = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  if (merged.length === 0 || merged[0]!.score < DEFAULT_CONFIG.search.minConfidence) {
    return { status: "unclear", candidates: [] };
  }
  return { status: "ok", candidates: merged };
}

interface Tally {
  top1: number;
  top3: number;
  positives: number;
  reprompted: number;
  negatives: number;
  gained: string[];
  lost: string[];
}

function run(useExpansion: boolean, baseline?: Map<string, boolean>) {
  const tally: Tally = {
    top1: 0,
    top3: 0,
    positives: 0,
    reprompted: 0,
    negatives: 0,
    gained: [],
    lost: [],
  };
  const hits = new Map<string, boolean>();

  for (const site of SITES) {
    if (SELF_SCORED.has(site)) continue;
    const catalog = JSON.parse(
      readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
    ) as MenuCatalog;
    const index = new MenuIndex(catalog);
    const embedding = NgramTfIdfProvider.build(index.documents());
    const pipeline = new SearchPipeline(index, DEFAULT_CONFIG, embedding);
    // 변형을 합칠 때는 문턱을 나중에 적용해야 해서, 열린 파이프라인이 따로 필요하다.
    const open = new SearchPipeline(
      index,
      { ...DEFAULT_CONFIG, search: { ...DEFAULT_CONFIG.search, minConfidence: 0 } },
      embedding,
    );
    const byId = new Map(catalog.map((menu) => [menu.id, menu]));

    for (const testCase of querySet.sites[site] ?? []) {
      tally.positives += 1;
      const outcome = searchExpanded(pipeline, open, testCase.query, useExpansion);
      const labels = outcome.candidates.map((c) => byId.get(c.menuId)?.label ?? "");
      const won = labels[0] === testCase.expect;
      const key = `${site}: "${testCase.query}"`;
      hits.set(key, won);
      if (won) tally.top1 += 1;
      else if (labels.includes(testCase.expect)) tally.top3 += 1;

      if (baseline) {
        const before = baseline.get(key) ?? false;
        if (won && !before) tally.gained.push(`${key} → ${testCase.expect}`);
        if (!won && before) tally.lost.push(`${key} (1위=${labels[0] ?? "되묻기"})`);
      }
    }

    for (const query of querySet.negative) {
      tally.negatives += 1;
      const outcome = searchExpanded(pipeline, open, query, useExpansion);
      if (outcome.status !== "ok") tally.reprompted += 1;
    }
  }

  return { tally, hits };
}

const before = run(false);
const after = run(true, before.hits);

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(0)}%`;
const line = (name: string, t: Tally) =>
  `  ${name.padEnd(14)}${`${t.top1}/${t.positives} ${pct(t.top1, t.positives)}`.padStart(12)}` +
  `${`${t.top1 + t.top3} ${pct(t.top1 + t.top3, t.positives)}`.padStart(13)}` +
  `${`${t.reprompted}/${t.negatives} ${pct(t.reprompted, t.negatives)}`.padStart(14)}`;

console.log(`\n  용어 사전을 질의 쪽에 붙이면 (하나은행 제외)\n`);
console.log(
  `  ${"".padEnd(14)}${"1순위 정답".padStart(12)}${"후보 3개 안".padStart(13)}${"옳게 되물음".padStart(14)}`,
);
console.log(line("지금", before.tally));
console.log(line("+ 질의 확장", after.tally));

if (after.tally.gained.length > 0) {
  console.log(`\n  얻은 것 ${after.tally.gained.length}건`);
  for (const item of after.tally.gained) console.log(`    ${item}`);
}
if (after.tally.lost.length > 0) {
  console.log(`\n  잃은 것 ${after.tally.lost.length}건`);
  for (const item of after.tally.lost) console.log(`    ${item}`);
}
console.log();
