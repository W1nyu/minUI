import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRAIN_SOURCES, explainMissingCorpus, isRecognized, loadCorpus } from "./corpus.js";
import { fitCosts } from "./fit.js";

/**
 * 코퍼스에서 자모 혼동 비용을 학습해 파일로 굽는다 (M21 Task 7).
 *
 * <p><b>학습 층위만 본다.</b> 다른 사람의 발화(`thirdparty-recorded`)는 손대지 않는다 —
 * 고른 뒤 한 번만 보는 홀드아웃이다. 이 규칙을 어기면 `bench:voice`가 재는 것이
 * 일반화가 아니라 암기가 된다.
 *
 * <p>규칙과 수식은 `fit.ts`에 있고 `bench:voice`가 교차검증에서 같은 함수를 쓴다.
 *
 * <pre>
 *   pnpm --filter tools fit:confusion
 * </pre>
 */

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../out/confusion.json");

function main(): void {
  const corpus = loadCorpus();
  if (!corpus) {
    explainMissingCorpus();
    process.exitCode = 1;
    return;
  }

  const train = corpus.rows.filter(
    (row) => TRAIN_SOURCES.includes(row.source) && isRecognized(row),
  );
  const holdout = corpus.rows.filter((row) => !TRAIN_SOURCES.includes(row.source));

  console.log("\n── 자모 혼동 비용 학습 (M21) ─────────────────────────────\n");
  console.log(`  코퍼스 ${corpus.rows.length}줄`);
  console.log(`  학습에 쓰는 줄 ${train.length}  (${TRAIN_SOURCES.join(" · ")})`);
  console.log(`  홀드아웃 ${holdout.length}줄 — 여기서 보지 않는다`);

  if (train.length === 0) {
    console.log("\n  학습할 줄이 없다. 표를 만들지 않았다.\n");
    process.exitCode = 1;
    return;
  }

  const { costs, top } = fitCosts(train);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(costs, null, 2)}\n`, "utf8");

  const counts =
    `치환 ${Object.keys(costs.subs).length} · ` +
    `삭제 ${Object.keys(costs.del).length} · ` +
    `삽입 ${Object.keys(costs.ins).length}`;
  console.log(`\n  배운 것 — ${counts}`);

  console.log("\n  가장 자주 본 혼동 (최대 20):");
  console.log("    의도 → 들림      본 횟수   비용");
  for (const entry of top.slice(0, 20)) {
    const [intended, heard] = entry.key.split(">");
    console.log(
      `    ${intended} → ${heard}          ${String(entry.count).padStart(4)}   ${entry.cost.toFixed(3)}`,
    );
  }

  console.log("\n  → tools/out/confusion.json");
  console.log("\n  다음: pnpm --filter tools bench:voice — 교차검증으로 값을 하는지 본다.");
  console.log("  값을 하면 이 표를 packages/core/src/config.ts의 search.confusion에 싣는다.\n");
}

main();
