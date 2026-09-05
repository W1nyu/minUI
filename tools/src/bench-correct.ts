import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  type MenuCatalog,
} from "@minui/core";
import { isSafeAssistQuery } from "@host-ai/privacy.js";
import {
  ALL_SITES,
  catalogFor,
  explainMissingCorpus,
  isAnswer,
  isRecognized,
  loadCorpus,
  type CorpusRow,
} from "./corpus.js";

/**
 * 잘못 들린 말을 모델이 고쳐 주는가 — 지금 있는 코퍼스로 오프라인 측정 (M23).
 *
 * <h3>왜 이것이 지금 답할 수 있는 질문인가</h3>
 *
 * <p>M22의 인식기 편향은 구글 인식기 <b>안에서</b> 일어나는 일이라 오디오 없이는 잴 수 없다.
 * 그런데 `/correct`는 인식기가 <b>뱉은 텍스트</b>를 다룬다 — 그 텍스트가 코퍼스에 292줄
 * 있으므로 추가 녹음 없이 끝까지 잴 수 있다.
 *
 * <h3>지금 제품에서 이 경로는 죽어 있다</h3>
 *
 * <p>`VoiceSearchSheet`는 <b>글로 쳤을 때만</b> `correct`를 부른다(:311의 주석이 이유를
 * 적어 두었다 — 음성은 신뢰도가 함께 오고 §9.2가 그 값으로 되묻기를 정하는데, 도우미를
 * 끼우면 그 경로가 달라진다). 그래서 오인식 교정이 <b>오인식이 일어나는 경로에서</b>
 * 안 돈다. 이 벤치가 그것을 켤 근거를 만든다.
 *
 * <h3>두 팔을 잰다</h3>
 *
 * <ul>
 *   <li><b>A. 되묻기일 때만</b> — 제품이 지금 텍스트 경로에서 쓰는 규칙 그대로.
 *       앱은 1순위가 틀렸는지 알 수 없고, 확신이 없다는 것만 안다.
 *   <li><b>B. 1순위가 틀렸을 때도</b> — <b>오라클 상한이다.</b> 실제로는 알 수 없는 정보를
 *       쓰므로 제품 수치가 아니다. 교정이 가진 <b>잠재력의 크기</b>만 말해 준다.
 * </ul>
 *
 * <pre>
 *   pnpm --filter demos dev        # /api/correct 가 필요하다 (api.txt 의 키를 쓴다)
 *   pnpm --filter tools bench:correct
 * </pre>
 */

const ENDPOINT = process.env["MINUI_CORRECT_URL"] ?? "http://localhost:5174/api/correct";

/**
 * 모델이 뭐라고 고쳤는지를 파일에 남긴다.
 *
 * <p><b>문턱을 고르려면 같은 답을 여러 번 봐야 한다.</b> 볼 때마다 모델을 다시 부르면
 * 답이 조금씩 달라져 무엇 때문에 수치가 움직였는지 알 수 없고, 값도 든다.
 * 한 번 받아 두고 그 위에서 실험한다. 다시 받으려면 이 파일을 지운다.
 */
const CACHE = join(dirname(fileURLToPath(import.meta.url)), "../out/corrections.json");
const cache: Record<string, string | null> = existsSync(CACHE)
  ? (JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string | null>)
  : {};
let cacheDirty = false;

function saveCache(): void {
  if (!cacheDirty) return;
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}${"\n"}`, "utf8");
}

/** `shared/host-ai/correct.ts`의 `MENU_COUNT`와 같은 값. 갈라지면 잰 것과 다른 답이 온다. */
const MENU_COUNT = 20;

/** 호출 사이의 간격. 개발 서버 뒤의 모델을 몰아치지 않는다. */
const GAP_MS = 250;

interface Outcome {
  top1: number;
  answered: number;
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

/**
 * 모델에게 보여 줄 메뉴 이름.
 *
 * <p>`makeCorrect`와 같은 방식이다 — 점수 순 후보로 채우고 모자라면 카탈로그 앞에서
 * 채운다. 모델에게 필요한 것은 점수가 아니라 <b>이 앱에 무엇이 있는지</b>다.
 */
function labelPool(pipeline: SearchPipeline, catalog: MenuCatalog, heard: string): string[] {
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of pipeline.rank(heard, MENU_COUNT)) {
    const menu = byId.get(candidate.menuId);
    if (menu && !seen.has(menu.label)) {
      seen.add(menu.label);
      labels.push(menu.label);
    }
  }
  for (const menu of catalog) {
    if (labels.length >= MENU_COUNT) break;
    if (seen.has(menu.label)) continue;
    seen.add(menu.label);
    labels.push(menu.label);
  }
  return labels.slice(0, MENU_COUNT);
}

async function correct(heard: string, labels: readonly string[]): Promise<string | null> {
  const key = `${labels[0] ?? ""}|${heard}`;
  if (key in cache) return cache[key]!;

  const value = await ask(heard, labels);
  cache[key] = value;
  cacheDirty = true;
  return value;
}

async function ask(heard: string, labels: readonly string[]): Promise<string | null> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ heard, candidates: labels.map((label) => ({ label })) }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { corrected?: unknown };
  const corrected = payload.corrected;
  if (typeof corrected !== "string" || corrected.trim().length === 0) return null;

  // 같은 말이면 고친 것이 아니다 — 호스트도 이 검사를 한다.
  const same = (value: string) => value.replace(/\s+/gu, "");
  if (same(corrected) === same(heard)) return null;
  return corrected.trim();
}

function top1Of(pipeline: SearchPipeline, row: CorpusRow, query: string): string | null {
  const hypotheses = query === row.heard && row.alternatives.length > 0
    ? row.alternatives.map((text) => ({ text }))
    : [{ text: query }];
  const outcome = pipeline.searchHypotheses(hypotheses);
  return outcome.status === "ok" ? outcome.candidates[0]!.menuId : null;
}

async function main(): Promise<void> {
  const corpus = loadCorpus();
  if (!corpus) {
    explainMissingCorpus();
    process.exitCode = 1;
    return;
  }

  const rows = corpus.rows.filter(
    (row) => isRecognized(row) && row.expect !== undefined && catalogFor(row.site) !== null,
  );

  console.log("\n── 잘못 들린 말 고치기 — 오프라인 측정 (M23) ──────────────\n");
  console.log(`  중계기 ${ENDPOINT}`);
  console.log(`  채점하는 줄 ${rows.length}\n`);

  const base: Outcome = { top1: 0, answered: 0 };
  const armA: Outcome = { top1: 0, answered: 0 };
  const armB: Outcome = { top1: 0, answered: 0 };

  let calls = 0;
  let blocked = 0;
  let refused = 0;
  /** 되묻던 것이 <b>틀린 확신</b>으로 바뀐 수. 이 프로젝트가 늘 0으로 지켜 온 값이다. */
  let repromptToWrong = 0;
  const fixed: string[] = [];
  const broke: string[] = [];
  const elapsed: number[] = [];

  for (const row of rows) {
    const pipeline = pipelineFor(row.site)!;
    const catalog = catalogFor(row.site)!;

    const before = top1Of(pipeline, row, row.heard);
    const outcome = pipeline.searchHypotheses(
      row.alternatives.length > 0 ? row.alternatives.map((t) => ({ text: t })) : [{ text: row.heard }],
    );
    const wasRight = before !== null && isAnswer(row.site, before, row.expect!);

    base.answered += 1;
    armA.answered += 1;
    armB.answered += 1;
    if (wasRight) {
      base.top1 += 1;
      armA.top1 += 1;
      armB.top1 += 1;
      continue;
    }

    /*
     * 개인정보 문은 클라이언트와 서버가 같은 코드를 본다. 여기서도 같은 문을 지난다 —
     * 문을 건너뛰고 재면 배포되지 않을 것을 잰 셈이다.
     */
    if (!isSafeAssistQuery(row.heard)) {
      blocked += 1;
      continue;
    }

    const started = performance.now();
    const corrected = await correct(row.heard, labelPool(pipeline, catalog, row.heard));
    elapsed.push(performance.now() - started);
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));

    if (corrected === null) {
      refused += 1;
      continue;
    }

    const after = top1Of(pipeline, row, corrected);
    const nowRight = after !== null && isAnswer(row.site, after, row.expect!);
    const label = (id: string | null) =>
      id === null ? "되묻기" : (catalog.find((m) => m.id === id)?.label ?? id);

    // B는 1순위가 틀린 모든 줄에서 부른다 — 오라클이다.
    if (nowRight) armB.top1 += 1;

    // A는 제품 규칙: 되묻기(확신 없음)일 때만 불렀을 것이다.
    const wouldCallA = outcome.status === "unclear";
    if (wouldCallA && nowRight) armA.top1 += 1;

    /*
     * **되묻기가 틀린 확신이 되는 것을 따로 센다.** 틀린 1순위가 다른 틀린 1순위가 되는
     * 것은 대가가 없다 — 어차피 틀렸다. 그러나 "모르겠으니 물어볼게요"가
     * "이거죠?"로 바뀌면서 틀리면, 사용자가 잘못된 화면으로 실려 간다.
     */
    if (outcome.status === "unclear" && after !== null && !nowRight) repromptToWrong += 1;

    const line = `"${row.heard}" → "${corrected}"  ${label(before)} → ${label(after)}  (정답 ${row.expect})`;
    if (nowRight) fixed.push(`${wouldCallA ? "A·B" : " B "}  ${line}`);
    else broke.push(`     ${line}`);
  }

  const pct = (o: Outcome) => `${((100 * o.top1) / o.answered).toFixed(1)}%`;
  const p95 = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  };

  console.log(`    교정 없이                     ${base.top1}/${base.answered}  ${pct(base)}`);
  console.log(`    A 되묻기일 때만 (제품 규칙)   ${armA.top1}/${armA.answered}  ${pct(armA)}`);
  console.log(`    B 1순위가 틀렸을 때도 (오라클) ${armB.top1}/${armB.answered}  ${pct(armB)}`);
  console.log("");
  console.log(`    호출 ${calls}회 · 개인정보 문에 막힘 ${blocked} · 모델이 안 고침 ${refused}`);
  console.log(`    호출 지연 p95 ${p95(elapsed).toFixed(0)}ms`);
  console.log(`    ★ 되묻기 → 틀린 확신  ${repromptToWrong}건`);
  console.log("");

  await negatives(corpus.rows);

  if (fixed.length > 0) {
    console.log(`    고친 것 ${fixed.length}:`);
    console.log(fixed.map((line) => `      ${line}`).join("\n"));
  }
  if (broke.length > 0) {
    console.log(`\n    고쳤지만 여전히 틀린 것 ${broke.length}:`);
    console.log(broke.slice(0, 15).map((line) => `      ${line}`).join("\n"));
  }
  console.log("");
  saveCache();
}

/**
 * 답이 없어야 할 질의에서 교정이 <b>없던 확신을 만들어 내는가.</b>
 *
 * <p>§12.6이 기록한 교훈이다 — 정답 있는 질의만 재면 무엇을 넣든 좋아 보인다.
 * 여기가 그 반대편이고, 이 프로젝트의 게이트는 늘 이 값을 0으로 요구했다.
 */
async function negatives(rows: readonly CorpusRow[]): Promise<void> {
  const cases = rows.filter((row) => isRecognized(row) && row.expect === undefined);
  console.log(`    ── 답 없는 질의 ${cases.length}건 × 카탈로그 ${ALL_SITES.length}곳 ──`);

  let before = 0;
  let after = 0;
  let calls = 0;
  const made: string[] = [];

  for (const row of cases) {
    if (!isSafeAssistQuery(row.heard)) continue;
    for (const site of ALL_SITES) {
      const pipeline = pipelineFor(site);
      const catalog = catalogFor(site);
      if (!pipeline || !catalog) continue;

      const outcome = pipeline.searchHypotheses([{ text: row.heard }]);
      if (outcome.status === "ok") {
        before += 1;
        after += 1;
        continue;
      }

      const corrected = await correct(row.heard, labelPool(pipeline, catalog, row.heard));
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
      if (corrected === null) continue;

      const repaired = pipeline.searchHypotheses([{ text: corrected }]);
      if (repaired.status === "ok") {
        after += 1;
        const id = repaired.candidates[0]!.menuId;
        made.push(
          `${site}  "${row.heard}" → "${corrected}" → ${catalog.find((m) => m.id === id)?.label ?? id}`,
        );
      }
    }
  }

  console.log(`      교정 없이 잘못된 확신 ${before}`);
  console.log(`      교정 넣고 잘못된 확신 ${after}   (증가 ${after - before}) · 호출 ${calls}회`);
  if (made.length > 0) {
    console.log(made.slice(0, 12).map((line) => `        ${line}`).join("\n"));
  }
  console.log("");
  saveCache();
}

void main();
