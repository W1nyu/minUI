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
  type SearchCandidate,
} from "@minui/core";

/**
 * 놓친 질의가 **왜** 놓쳤는가.
 *
 * <p>벤치마크는 맞았다/틀렸다만 말한다. 그것으로는 "0.54라서 아깝게 되물었다"와
 * "0.08이라 애초에 정보가 없다"를 구분할 수 없는데, 둘은 해법이 정반대다.
 * 앞엣것은 임계값을 만지면 되고 뒤엣것은 동의어를 붙이는 수밖에 없다.
 *
 * <p>측정 방법: 임계값을 0으로, 후보 수를 넉넉히 열어 <b>같은 파이프라인</b>을 돌린다.
 * 채점 로직을 여기에 다시 구현하지 않는 것이 요점이다 — 그러면 재는 대상과 재는 자가
 * 서로 달라져 결과가 실제 동작을 말하지 않게 된다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;

/** 자기 채점 문제로 다른 곳과 나란히 볼 수 없는 사이트. 합계에서 뺀다. */
const SELF_SCORED = new Set<string>(["kebhana"]);

interface Case {
  query: string;
  expect: string;
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
) as { sites: Record<string, Case[]> };

/** 문턱을 없앤 설정. 점수를 보기 위한 것이지 이렇게 쓰자는 제안이 아니다. */
const OPEN = resolveConfig({ search: { minConfidence: 0, maxCandidates: 200 } });

type Reason =
  | "되묻기"
  | "갈래가 이김"
  | "형제가 이김"
  | "정확매칭에 잘림"
  | "2~3순위"
  | "정답";

interface Row {
  site: string;
  query: string;
  expect: string;
  reason: Reason;
  /** 실제 파이프라인이 1순위로 올린 것. */
  winner: string;
  winnerScore: number;
  winnerStage: string;
  /** 정답 메뉴의 점수와 등수. 후보에 아예 없으면 rank는 null. */
  expectScore: number;
  expectStage: string;
  expectRank: number | null;
  /** 정답이 임계값(0.55)을 넘었는가. */
  overThreshold: boolean;
}

const rows: Row[] = [];

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;

  const byId = new Map(catalog.map((menu) => [menu.id, menu]));
  const index = new MenuIndex(catalog);
  const embedding = NgramTfIdfProvider.build(index.documents());

  const real = new SearchPipeline(index, DEFAULT_CONFIG, embedding);
  const open = new SearchPipeline(index, OPEN, embedding);

  /** 정답 라벨을 가진 메뉴들. 라벨은 유일하므로 보통 하나다. */
  const targetsOf = (label: string) =>
    new Set(catalog.filter((menu) => menu.label === label).map((menu) => menu.id));

  for (const testCase of querySet.sites[site] ?? []) {
    const targets = targetsOf(testCase.expect);
    if (targets.size === 0) {
      console.log(`  ! ${site} "${testCase.query}" — 정답 라벨이 카탈로그에 없다`);
      continue;
    }

    const actual = real.search(testCase.query);
    const full = open.search(testCase.query);
    const ranked: SearchCandidate[] = full.status === "ok" ? full.candidates : [];

    const winner = ranked[0];
    const rank = ranked.findIndex((candidate) => targets.has(candidate.menuId));
    const hit = rank >= 0 ? ranked[rank] : undefined;

    // 실제 동작에서 맞았는가.
    const actualTop =
      actual.status === "ok" ? (actual.candidates[0]?.menuId ?? null) : null;
    const actualIds =
      actual.status === "ok" ? actual.candidates.map((c) => c.menuId) : [];

    let reason: Reason;
    if (actualTop !== null && targets.has(actualTop)) reason = "정답";
    else if (actual.status === "unclear") reason = "되묻기";
    else if (actualIds.some((id) => targets.has(id))) reason = "2~3순위";
    else if (rank < 0) reason = "정확매칭에 잘림";
    else {
      // 이긴 것이 정답의 상위 메뉴인가, 아니면 옆 갈래인가.
      const target = byId.get([...targets][0]!);
      const winnerMenu = winner ? byId.get(winner.menuId) : undefined;
      const targetPath = (target?.path ?? []).join(">");
      const winnerFull = [...(winnerMenu?.path ?? []), winnerMenu?.label ?? ""].join(">");
      reason = targetPath === winnerFull ? "갈래가 이김" : "형제가 이김";
    }

    if (reason === "정답") continue;

    rows.push({
      site,
      query: testCase.query,
      expect: testCase.expect,
      reason,
      winner: winner ? (byId.get(winner.menuId)?.label ?? winner.menuId) : "—",
      winnerScore: winner?.score ?? 0,
      winnerStage: winner?.matchedBy ?? "—",
      expectScore: hit?.score ?? 0,
      expectStage: hit?.matchedBy ?? "—",
      expectRank: rank >= 0 ? rank + 1 : null,
      overThreshold: (hit?.score ?? 0) >= DEFAULT_CONFIG.search.minConfidence,
    });
  }
}

// ── 보고 ─────────────────────────────────────────────────────────────────

const pad = (value: string | number, width: number) => String(value).padEnd(width);
const num = (value: number) => value.toFixed(3);

console.log(
  `\n  놓친 질의 ${rows.length}건 — 정답 메뉴가 실제로 몇 점을 받았는가\n` +
    `  (임계값 ${DEFAULT_CONFIG.search.minConfidence}. 점수가 이보다 낮으면 되묻는다)\n`,
);

for (const site of SITES) {
  const mine = rows.filter((row) => row.site === site);
  if (mine.length === 0) continue;
  console.log(`  ── ${site}${SELF_SCORED.has(site) ? " (자기 채점 — 참고만)" : ""}`);
  for (const row of mine) {
    console.log(
      `    ${pad(row.reason, 12)} "${row.query}"`.padEnd(52) +
        `정답 ${pad(row.expect, 22)} ${num(row.expectScore)} ${pad(row.expectStage, 9)}` +
        `${row.expectRank === null ? "순위없음" : `${row.expectRank}위`}`,
    );
    console.log(
      `    ${" ".repeat(12)} `.padEnd(52) +
        `1위  ${pad(row.winner, 22)} ${num(row.winnerScore)} ${row.winnerStage}`,
    );
  }
  console.log();
}

const scored = rows.filter((row) => !SELF_SCORED.has(row.site));

const near = scored.filter(
  (row) => row.reason === "되묻기" && row.expectScore >= 0.4,
);
const far = scored.filter((row) => row.reason === "되묻기" && row.expectScore < 0.4);

console.log("  ── 요약 (자기 채점 사이트 제외)\n");
const byReason = new Map<Reason, number>();
for (const row of scored) byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
for (const [reason, count] of byReason) console.log(`    ${pad(reason, 14)} ${count}건`);

console.log(
  `\n    되묻기 ${near.length + far.length}건 중` +
    ` 아깝게 걸린 것(0.40~0.55) ${near.length}건 · 정보가 없는 것(<0.40) ${far.length}건`,
);

if (near.length > 0) {
  const highest = Math.max(...near.map((row) => row.expectScore));
  console.log(
    `    임계값을 ${num(highest)} 아래로 내리면 ${near.length}건이 후보로 올라온다 —` +
      ` 다만 그만큼 엉뚱한 후보도 함께 올라온다.`,
  );
}

const zero = scored.filter((row) => row.expectScore === 0);
if (zero.length > 0) {
  console.log(
    `    정답이 0점인 것 ${zero.length}건 — 질의의 말이 라벨에도 동의어에도 없다.` +
      ` 임계값으로는 못 고친다.`,
  );
}
console.log();
