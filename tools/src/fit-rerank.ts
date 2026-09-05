import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_NAMES } from "@minui/core";
import { buildSplit, toVector, toWeights, type Sample } from "./rerank-data.js";

/**
 * 후보 재순위 가중치를 적합한다 (M23).
 *
 * <h3>무엇을 학습하는가</h3>
 *
 * <p>후보 하나가 정답인지 아닌지를 맞히는 <b>로지스틱 회귀</b>다. 순위 학습(pairwise)도
 * 생각했지만 표본이 작아 단순한 쪽을 골랐다 — 특징 8개에 질의 수백 개다.
 *
 * <p><b>L2 정규화를 건다.</b> 표본이 작으면 가중치가 커지면서 몇 개 예시를 외운다.
 * 홀드아웃이 그것을 잡겠지만, 애초에 덜 외우게 하는 편이 낫다.
 *
 * <p><b>학습 세트만 본다.</b> 홀드아웃(KB국민·미래에셋 ∩ 화자 B1)은 여기서 열지 않는다.
 *
 * <pre>
 *   pnpm --filter tools fit:rerank
 * </pre>
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../out/rerank.json");

/** 경사하강 반복 수. 특징 8개라 이것으로 충분히 수렴한다. */
const STEPS = 4000;
const LEARNING_RATE = 0.5;

/**
 * L2 세기. **재서 고른 값이 아니라 보수적으로 놓은 것이다.**
 *
 * <p>표본이 작으므로 강하게 건다. 홀드아웃에서 안 오르면 이 값을 올리는 것이 아니라
 * 특징을 줄이거나 이 축을 접는다 — 정규화를 흔들어 홀드아웃을 맞추면 그 순간
 * 홀드아웃이 튜닝 세트가 된다.
 */
const L2 = 0.05;

interface Row {
  x: number[];
  y: number;
}

/** 질의마다 정답 하나와 오답들. 질의 길이로 나눠 긴 후보 목록이 학습을 지배하지 않게 한다. */
function toRows(samples: readonly Sample[]): Row[] {
  const rows: Row[] = [];
  for (const sample of samples) {
    for (const candidate of sample.candidates) {
      rows.push({ x: toVector(candidate.features), y: candidate.correct ? 1 : 0 });
    }
  }
  return rows;
}

function fit(rows: readonly Row[]): number[] {
  const dim = FEATURE_NAMES.length;
  const weights = new Array<number>(dim).fill(0);
  const positives = rows.filter((row) => row.y === 1).length;
  const negatives = rows.length - positives;

  /*
   * **양성이 훨씬 적다** (질의당 정답 1개, 후보 8개). 가중치를 안 주면 학습이
   * "전부 오답"이라고 답하는 것이 이득이라고 배운다.
   */
  const positiveWeight = negatives / Math.max(1, positives);

  for (let step = 0; step < STEPS; step++) {
    const gradient = new Array<number>(dim).fill(0);

    for (const row of rows) {
      let z = 0;
      for (let i = 0; i < dim; i++) z += weights[i]! * row.x[i]!;
      const p = 1 / (1 + Math.exp(-z));
      const w = row.y === 1 ? positiveWeight : 1;
      const error = (p - row.y) * w;
      for (let i = 0; i < dim; i++) gradient[i]! += error * row.x[i]!;
    }

    for (let i = 0; i < dim; i++) {
      const g = gradient[i]! / rows.length + L2 * weights[i]!;
      weights[i]! -= LEARNING_RATE * g;
    }
  }

  return weights;
}

function main(): void {
  const split = buildSplit();
  const rows = toRows(split.train);

  console.log("\n── 후보 재순위 가중치 적합 (M23) ──────────────────────────\n");
  console.log(`  학습 질의 ${split.train.length}  ·  홀드아웃 질의 ${split.holdout.length} (여기서 안 본다)`);
  console.log(`  학습 후보 ${rows.length}  ·  그중 정답 ${rows.filter((r) => r.y === 1).length}`);

  if (split.train.length < 20) {
    console.log("\n  학습할 질의가 너무 적다. 적합하지 않았다.\n");
    process.exitCode = 1;
    return;
  }

  const vector = fit(rows);
  const weights = toWeights(vector);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(weights, null, 2)}\n`, "utf8");

  console.log("\n  배운 가중치 (특징은 전부 0..1이라 크기를 그대로 비교할 수 있다)");
  const sorted = [...FEATURE_NAMES].sort(
    (a, b) => Math.abs(weights[b] ?? 0) - Math.abs(weights[a] ?? 0),
  );
  for (const name of sorted) {
    const value = weights[name] ?? 0;
    const bar = "█".repeat(Math.min(30, Math.round(Math.abs(value) * 10)));
    console.log(`    ${name.padEnd(12)} ${value >= 0 ? " " : "-"}${Math.abs(value).toFixed(4).padStart(7)}  ${bar}`);
  }

  console.log(`\n  → tools/out/rerank.json`);
  console.log("\n  다음: pnpm --filter tools bench:rerank — 홀드아웃에서 게이트를 넘는지 본다.\n");
}

main();
