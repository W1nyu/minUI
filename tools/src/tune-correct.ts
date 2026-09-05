import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  jamoSimilarity,
  normalize,
  pronounce,
} from "@minui/core";
import { ALL_SITES, catalogFor, isAnswer, isRecognized, loadCorpus } from "./corpus.js";

/**
 * 모델이 고친 말을 <b>얼마나 믿을 것인가</b> — 소리 거리 문턱의 저울 (M23).
 *
 * <h3>왜 문턱이 필요한가</h3>
 *
 * <p>`bench:correct`가 잰 것: 정답 있는 질의는 86.8% → 88.5%로 오르는데,
 * <b>답이 없어야 할 질의에서 잘못된 확신이 2 → 32로 뛴다.</b> 모델은 "모르겠다"고
 * 말할 줄 모른다 — 은행 메뉴 목록을 주고 "오늘 뉴스 좀 보여 줘"를 고치라고 하면
 * `펀드 소식 알려줘`를 지어낸다.
 *
 * <h3>엔진이 모델을 검증한다</h3>
 *
 * <p>진짜 오인식 복구와 지어낸 말은 <b>소리의 거리</b>가 다르다.
 *
 * <pre>
 *   도 붙여야 하는데     → 돈 보내야 하는데     0.62  가깝다 — 잘못 들은 것을 되돌린 것
 *   오늘 뉴스 좀 보여 줘 → 펀드 소식 알려줘     0.14  멀다  — 주제를 갈아 끼운 것
 * </pre>
 *
 * <p>그 거리를 재는 자가 이미 있다 — M21의 발음 표기와 자모 유사도다. <b>모델이 제안하고
 * 엔진이 판정한다.</b> `copilot.ts`의 `validateProposal`이 메뉴 id·위험도에 대해 하는 일을
 * 여기서는 소리에 대해 한다.
 *
 * <p>거리는 <b>대칭</b>으로 잰다. `jamoSimilarity`는 방향이 있어서 짧은 쪽을 긴 쪽 안에서
 * 찾는데, 여기서 필요한 것은 "두 말이 서로 얼마나 닮았나"이지 포함 관계가 아니다.
 * 한쪽만 보면 `"청약 줘"` → `"청약 신청 관련해서 자세히 알려줘"` 같은 부풀리기가 통과한다.
 *
 * <pre>
 *   pnpm --filter tools bench:correct   # 먼저. 모델 답을 out/corrections.json 에 받아 둔다
 *   pnpm --filter tools tune:correct
 * </pre>
 */

const CACHE = join(dirname(fileURLToPath(import.meta.url)), "../out/corrections.json");

/** 재 볼 문턱들. `1.01`은 교정을 통째로 끈 것 — 지금 배포되는 상태다. */
const FLOORS = [1.01, 0, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6] as const;

/**
 * 두 말이 소리로 얼마나 닮았나. 0..1, **대칭**.
 *
 * <p>이 함수가 `shared/host-ai/correct.ts`에 그대로 들어갈 판정이다. 여기서 고른 문턱이
 * 거기 실린다 — 저울과 제품이 같은 자를 써야 잰 것이 배포된다.
 */
export function soundDistance(a: string, b: string): number {
  const left = pronounce(normalize(a));
  const right = pronounce(normalize(b));
  if (left.length === 0 || right.length === 0) return 0;
  return Math.min(jamoSimilarity(left, right), jamoSimilarity(right, left));
}

const pipelines = new Map<string, SearchPipeline>();

function pipelineFor(site: string): SearchPipeline | null {
  const cached = pipelines.get(site);
  if (cached) return cached;
  const catalog = catalogFor(site);
  if (!catalog) return null;
  const index = new MenuIndex(catalog);
  const pipeline = new SearchPipeline(
    index,
    DEFAULT_CONFIG,
    NgramTfIdfProvider.build(index.documents()),
  );
  pipelines.set(site, pipeline);
  return pipeline;
}

function main(): void {
  const corpus = loadCorpus();
  if (!corpus) {
    console.log("\n  음성 코퍼스가 없다.\n");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(CACHE)) {
    console.log("\n  모델 답이 없다 — pnpm --filter tools bench:correct 를 먼저 돌린다.\n");
    process.exitCode = 1;
    return;
  }

  const cache = JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string | null>;
  const byHeard = new Map<string, string>();
  for (const [key, value] of Object.entries(cache)) {
    if (typeof value === "string") byHeard.set(key.slice(key.indexOf("|") + 1), value);
  }

  const answerable = corpus.rows.filter(
    (row) => isRecognized(row) && row.expect !== undefined && catalogFor(row.site) !== null,
  );
  const negatives = corpus.rows.filter((row) => isRecognized(row) && row.expect === undefined);

  console.log("\n── 모델 교정을 얼마나 믿을 것인가 (M23) ────────────────────\n");
  console.log(`  정답 있는 줄 ${answerable.length} · 답 없는 줄 ${negatives.length} × 카탈로그 ${ALL_SITES.length}곳`);
  console.log("  **되묻기일 때만 부른다** — 제품 규칙 그대로\n");
  console.log("  소리 문턱   1순위 정답        되묻기→틀린확신   답없는질의 잘못된확신");

  for (const floor of FLOORS) {
    let top1 = 0;
    let repromptToWrong = 0;
    let falseConfidence = 0;

    for (const row of answerable) {
      const pipeline = pipelineFor(row.site)!;
      const hypotheses =
        row.alternatives.length > 0
          ? row.alternatives.map((text) => ({ text }))
          : [{ text: row.heard }];
      const outcome = pipeline.searchHypotheses(hypotheses);

      if (outcome.status === "ok") {
        if (isAnswer(row.site, outcome.candidates[0]!.menuId, row.expect!)) top1 += 1;
        continue;
      }

      const fix = byHeard.get(row.heard);
      if (fix === undefined || soundDistance(row.heard, fix) < floor) continue;

      const after = pipeline.searchHypotheses([{ text: fix }]);
      if (after.status !== "ok") continue;
      if (isAnswer(row.site, after.candidates[0]!.menuId, row.expect!)) top1 += 1;
      else repromptToWrong += 1;
    }

    for (const row of negatives) {
      for (const site of ALL_SITES) {
        const pipeline = pipelineFor(site);
        if (!pipeline) continue;
        if (pipeline.searchHypotheses([{ text: row.heard }]).status === "ok") {
          falseConfidence += 1;
          continue;
        }
        const fix = byHeard.get(row.heard);
        if (fix === undefined || soundDistance(row.heard, fix) < floor) continue;
        if (pipeline.searchHypotheses([{ text: fix }]).status === "ok") falseConfidence += 1;
      }
    }

    const name = floor > 1 ? "교정 끔" : floor.toFixed(2);
    const share = `${((100 * top1) / answerable.length).toFixed(1)}%`;
    console.log(
      `  ${name.padEnd(10)} ${String(top1).padStart(3)}/${answerable.length}  ${share.padStart(6)}` +
        `        ${String(repromptToWrong).padStart(3)}` +
        `                ${String(falseConfidence).padStart(3)}`,
    );
  }

  console.log(
    "\n  읽는 법: 「교정 끔」이 지금 배포되는 값이다. 문턱을 올릴수록 지어낸 교정이 걸러지고,\n" +
      "  너무 올리면 진짜 복구까지 잘린다. 답 없는 질의의 잘못된 확신이 늘지 않는 선에서 고른다.\n",
  );
}

main();
