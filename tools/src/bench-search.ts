import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  type MenuCatalog,
  type MenuId,
} from "@minui/core";
import { CATALOG } from "../../frontend/src/catalog.js";

/**
 * 음성/텍스트 검색 벤치마크 (기획안 §12.2-C, M4의 DoD).
 *
 * 목표: 구어체 질의 50건 중 **75% 이상**이 1회 발화로 정확한 메뉴에 도달한다.
 *
 * 이 스크립트가 재는 것은 STT 인식률이 아니라 **인식된 텍스트에서 메뉴를 찾는 능력**이다.
 * 두 가지를 분리해서 재야 Provider를 바꿨을 때 무엇이 좋아졌는지 말할 수 있다(§9.1).
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface BenchCase {
  query: string;
  expect: MenuId;
}

interface QuerySet {
  description: string;
  cases: BenchCase[];
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../fixtures/voice-queries.json"), "utf8"),
) as QuerySet;

function run(label: string, catalog: MenuCatalog, useEmbedding: boolean) {
  const index = new MenuIndex(catalog);
  const embedding = useEmbedding ? NgramTfIdfProvider.build(index.documents()) : undefined;
  const pipeline = new SearchPipeline(index, DEFAULT_CONFIG, embedding);

  let top1 = 0;
  let top3 = 0;
  let unclear = 0;
  const byStage = new Map<string, number>();
  const failures: string[] = [];

  for (const testCase of querySet.cases) {
    const result = pipeline.search(testCase.query);

    if (result.status === "unclear") {
      unclear += 1;
      failures.push(`  되묻기  "${testCase.query}"  (정답: ${testCase.expect})`);
      continue;
    }

    const ids = result.candidates.map((c) => c.menuId);
    const first = result.candidates[0]!;

    if (ids[0] === testCase.expect) {
      top1 += 1;
      byStage.set(first.matchedBy, (byStage.get(first.matchedBy) ?? 0) + 1);
    } else if (ids.includes(testCase.expect)) {
      top3 += 1;
      failures.push(
        `  2~3순위 "${testCase.query}"  1순위=${ids[0]} (정답: ${testCase.expect})`,
      );
    } else {
      failures.push(
        `  오답    "${testCase.query}"  → ${ids[0]} [${first.matchedBy}] (정답: ${testCase.expect})`,
      );
    }
  }

  const total = querySet.cases.length;
  const rate = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 46 - label.length))}`);
  console.log(`  질의 ${total}건`);
  console.log(`  1회 발화 정확 매칭   ${top1}/${total}  ${rate(top1)}   ← DoD 75%`);
  console.log(`  후보 3개 안에 포함    ${top1 + top3}/${total}  ${rate(top1 + top3)}`);
  console.log(`  되묻기               ${unclear}/${total}  ${rate(unclear)}`);
  console.log(
    `  1순위를 올린 단계     ${[...byStage].map(([k, v]) => `${k} ${v}`).join(" · ")}`,
  );

  if (failures.length > 0) {
    console.log(`\n  놓친 것 ${failures.length}건:`);
    for (const line of failures) console.log(line);
  }

  return { top1, top3, unclear, total };
}

console.log(`\n${querySet.description}\n`);

// 기획안 §14가 M4의 확인 항목으로 남긴 비교 — 의미 매칭이 실제로 값을 하는가.
const withEmbedding = run("동의어 + 자모 + n-gram 유사도", CATALOG, true);
run("동의어 + 자모만 (의미 매칭 없이)", CATALOG, false);

const passed = withEmbedding.top1 / withEmbedding.total >= 0.75;
console.log(
  `\n${passed ? "DoD 충족" : "DoD 미달"} — 1회 발화 정확 매칭 ${(
    (withEmbedding.top1 / withEmbedding.total) *
    100
  ).toFixed(1)}% (기준 75%)\n`,
);

process.exitCode = passed ? 0 : 1;
