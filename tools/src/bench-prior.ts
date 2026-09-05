import {
  DEFAULT_CONFIG,
  EventStore,
  MenuIndex,
  NgramTfIdfProvider,
  RankingEngine,
  SearchPipeline,
  toPrior,
  type MenuCatalog,
  type MinUIConfig,
} from "@minui/core";
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
 * 사전확률이 값을 하는가 — 한 줄 빼기로 잰다 (M22 층 2).
 *
 * <h3>사용 이력이 없다는 문제를 정직하게 푼다</h3>
 *
 * <p>사전확률은 "이 사람이 전에 무엇을 했는가"를 재료로 쓰는데, 음성 코퍼스에는 그 이력이
 * 없다. 이력을 지어내면 그 이력이 답을 정해 버린다.
 *
 * <p>그래서 <b>그 줄을 뺀 나머지</b>의 정답 메뉴로만 이력을 만들고 그 줄을 채점한다.
 * 사용자가 그 질의 <b>이전에</b> 한 일로만 사전확률이 생기므로 순환이 아니다.
 * 기계학습의 leave-one-out과 같은 것이고, 여기서는 그것이 실제 사용 순서를 흉내 내기도 한다.
 *
 * <h3>이 측정이 답하지 못하는 것</h3>
 *
 * <ul>
 *   <li><b>시간 맥락은 끈다.</b> 프롬프트에 시각이 없다. 방문을 전부 같은 시각에 넣으면
 *       `contextBoost`가 `minObservations`에서 0을 주고, 그게 맞다 — 잴 수 없는 것을
 *       잰 척하지 않는다. 월별·요일·시간대 축의 값은 이 수치에 <b>포함되지 않았다.</b>
 *   <li><b>이력의 모양이 실제와 다르다.</b> 코퍼스는 메뉴마다 한두 번씩 고르게 나오는데,
 *       실제 사용은 몇 개에 쏠린다. 쏠릴수록 사전확률이 유리하므로 이 수치는
 *       <b>보수적인 쪽</b>이다.
 * </ul>
 *
 * <pre>
 *   pnpm --filter tools bench:prior
 * </pre>
 */

/** 사전확률을 끈 설정과 켠 설정. 그 밖의 모든 값은 배포되는 것과 같다. */
const OFF: MinUIConfig = DEFAULT_CONFIG;
const ON: MinUIConfig = {
  ...DEFAULT_CONFIG,
  search: {
    ...DEFAULT_CONFIG.search,
    prior: { ...DEFAULT_CONFIG.search.prior, enabled: true },
  },
};

/** 이력을 넣을 시각. 하나로 고정한다 — 시간 맥락을 끄기 위한 것이다. */
const HISTORY_AT = Date.UTC(2026, 8, 1);
const NOW = Date.UTC(2026, 8, 5);

interface Arm {
  top1: number;
  answered: number;
  moved: string[];
}

function pipelineFor(site: string, config: MinUIConfig): SearchPipeline | null {
  const catalog = catalogFor(site);
  if (!catalog) return null;
  const index = new MenuIndex(catalog);
  return new SearchPipeline(index, config, NgramTfIdfProvider.build(index.documents()));
}

/**
 * 그 줄을 뺀 나머지로 사전확률을 만든다.
 *
 * <p><b>같은 사이트의 줄만 본다.</b> 검색은 한 번에 카탈로그 하나만 보고, 개인화도
 * 그 앱 안에서만 쌓인다.
 */
function priorWithout(rows: readonly CorpusRow[], skip: CorpusRow, catalog: MenuCatalog) {
  const events = new EventStore(ON);
  const ranking = new RankingEngine(ON, events);

  for (const row of rows) {
    if (row === skip) continue;
    if (row.site !== skip.site || row.expect === undefined) continue;
    const menu = catalog.find(
      (item) => item.id === row.expect || item.label === row.expect,
    );
    if (!menu) continue;
    events.record({ type: "menu_enter", menuId: menu.id, at: HISTORY_AT }, HISTORY_AT);
    events.record({ type: "task_complete", menuId: menu.id, at: HISTORY_AT }, HISTORY_AT);
  }

  return toPrior(ranking.scoreAll({ catalog, now: NOW }), ON.search.prior);
}

function main(): void {
  const corpus = loadCorpus();
  if (!corpus) {
    explainMissingCorpus();
    process.exitCode = 1;
    return;
  }

  const rows = corpus.rows.filter(
    (row) => isRecognized(row) && row.expect !== undefined && catalogFor(row.site) !== null,
  );

  console.log("\n── 사전확률 한 줄 빼기 (M22 층 2) ─────────────────────────\n");
  console.log(`  채점하는 줄 ${rows.length}  (인식된 · 정답 있는 · 카탈로그 있는 것)`);
  console.log("  시간 맥락은 껐다 — 프롬프트에 시각이 없다\n");

  const off: Arm = { top1: 0, answered: 0, moved: [] };
  const on: Arm = { top1: 0, answered: 0, moved: [] };

  /*
   * **층위를 나눠 본다 — 탐색적이다.**
   *
   * 전체 수치를 보고 나서 나눈 것이므로 판정 근거가 아니다. 답하려는 것은 하나다:
   * "사전확률이 안 듣는 것인가, 이 코퍼스가 사전확률을 못 보는 것인가."
   *
   * 평가 세트는 서로 다른 메뉴를 넓게 덮으려고 만들어졌다. 그래서 한 줄을 빼면 정답 메뉴의
   * 이력이 0~1회만 남는 줄이 절반이고, 그런 줄에서 사전확률은 정답에 대해 <b>아무 정보도
   * 갖지 못한다.</b> 실사용은 반대다 — 자주 쓰는 것을 또 쓴다.
   */
  const strata = new Map<string, { off: number; on: number; n: number }>([
    ["이력 0회", { off: 0, on: 0, n: 0 }],
    ["이력 1회", { off: 0, on: 0, n: 0 }],
    ["이력 2회 이상", { off: 0, on: 0, n: 0 }],
  ]);

  for (const row of rows) {
    const catalog = catalogFor(row.site)!;
    const offPipe = pipelineFor(row.site, OFF);
    const onPipe = pipelineFor(row.site, ON);
    if (!offPipe || !onPipe) continue;

    const hypotheses = (row.alternatives.length > 0 ? row.alternatives : [row.heard]).map(
      (text) => ({ text }),
    );

    const before = offPipe.searchHypotheses(hypotheses);
    const prior = priorWithout(rows, row, catalog);
    const after = onPipe.searchHypotheses(hypotheses, { prior });

    // 이 줄에 대해 사전확률이 신호를 갖고 있었는가 = 정답 메뉴의 남은 이력 횟수
    const target = catalog.find(
      (item) => item.id === row.expect || item.label === row.expect,
    );
    const history = rows.filter(
      (other) =>
        other !== row &&
        other.site === row.site &&
        target !== undefined &&
        (other.expect === target.id || other.expect === target.label),
    ).length;
    const bucket =
      history === 0 ? "이력 0회" : history === 1 ? "이력 1회" : "이력 2회 이상";

    off.answered += 1;
    on.answered += 1;

    const hit = (outcome: typeof before): string | null =>
      outcome.status === "ok" ? outcome.candidates[0]!.menuId : null;

    const a = hit(before);
    const b = hit(after);
    const aRight = a !== null && isAnswer(row.site, a, row.expect!);
    const bRight = b !== null && isAnswer(row.site, b, row.expect!);
    if (aRight) off.top1 += 1;
    if (bRight) on.top1 += 1;

    const stratum = strata.get(bucket)!;
    stratum.n += 1;
    if (aRight) stratum.off += 1;
    if (bRight) stratum.on += 1;

    if (a !== b) {
      const label = (id: string | null) =>
        id === null ? "되묻기" : (catalog.find((m) => m.id === id)?.label ?? id);
      const mark = bRight ? "고침" : aRight ? "망침" : "옮김";
      on.moved.push(`${mark}  "${row.heard}"  ${label(a)} → ${label(b)}  (정답 ${row.expect})`);
    }
  }

  const pct = (arm: Arm) =>
    arm.answered === 0 ? "  —  " : `${((100 * arm.top1) / arm.answered).toFixed(1)}%`;
  const lift =
    off.answered === 0 ? 0 : (100 * (on.top1 - off.top1)) / off.answered;

  console.log(`    사전확률 없이   ${off.top1}/${off.answered}  ${pct(off)}`);
  console.log(`    사전확률 넣고   ${on.top1}/${on.answered}  ${pct(on)}`);
  console.log(`    차이            ${lift >= 0 ? "+" : ""}${lift.toFixed(1)}%p\n`);

  const fixed = on.moved.filter((line) => line.startsWith("고침")).length;
  const broken = on.moved.filter((line) => line.startsWith("망침")).length;
  console.log("    ── 탐색적 층위 나누기 (판정 근거 아님) ──");
  console.log("      사전확률이 그 줄에 대해 신호를 갖고 있었는가");
  console.log("      층위             줄수   없이     넣고");
  for (const [name, value] of strata) {
    const share = (hit: number) =>
      value.n === 0 ? "  —  " : `${((100 * hit) / value.n).toFixed(1)}%`;
    console.log(
      `      ${name.padEnd(14)} ${String(value.n).padStart(4)}  ${share(value.off).padStart(6)}  ${share(value.on).padStart(6)}`,
    );
  }
  console.log("");

  console.log(`    바뀐 줄 ${on.moved.length}  (고침 ${fixed} · 망침 ${broken})`);
  if (on.moved.length > 0) {
    console.log(on.moved.slice(0, 20).map((line) => `      ${line}`).join("\n"));
  }
  console.log("");
}

main();
