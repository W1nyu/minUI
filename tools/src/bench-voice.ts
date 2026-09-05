import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, UNIFORM_COSTS, type ConfusionCosts, type MinUIConfig } from "@minui/core";
import {
  ALL_SITES,
  HOLDOUT_SOURCES,
  TRAIN_SOURCES,
  explainMissingCorpus,
  isAnswer,
  isRecognized,
  loadCorpus,
  pipelineFor,
  type CorpusRow,
  type Source,
} from "./corpus.js";
import { fitCosts } from "./fit.js";

/**
 * 음성 경로를 실제 STT 출력으로 잰다 (M21 Task 7).
 *
 * <p><b>이 프로젝트가 지금까지 재지 못한 것이다.</b> `bench:search`도 `bench:sites`도
 * 손으로 친 문장을 파이프라인에 직접 넣는다. 간판 입력 경로인 음성은 한 번도 실제
 * 인식기를 지난 적이 없었다.
 *
 * <h3>사전 등록 게이트</h3>
 *
 * <p>`bench-neural.ts`가 세운 방식을 그대로 따른다 — <b>재기 전에</b> 통과 기준을 코드에
 * 적어 둔다. 수치를 보고 기준을 고치면 그 측정은 자기 자신을 채점한 것이다.
 *
 * <pre>
 *   pnpm --filter tools bench:voice
 * </pre>
 */

/**
 * **측정 전에 못 박은 기준.** 고치려면 왜 고치는지를 기획안에 먼저 적는다.
 */
const GATE = {
  /** ④가 ①보다 1순위 정답에서 이만큼(%p) 올라야 한다. */
  top1Lift: 8,
  /** 답이 없어야 할 질의를 자신 있게 여는 것이 늘면 안 된다. */
  worseConfident: 0,
  /** 질의당 추가 지연 p95 (ms). 온디바이스라 여유 있게 잡았다. */
  p95Ms: 30,
  /** 텍스트 벤치는 한 건도 잃지 않는다. `bench:search`·`bench:sites`로 따로 확인한다. */
  textRegression: 0,
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const FITTED = join(here, "../out/confusion.json");

/**
 * `fit:confusion`이 **학습 층위에서만** 구운 표.
 *
 * <p>홀드아웃(다른 사람의 발화)은 이 표를 만드는 데 쓰이지 않았다. 그래서 홀드아웃에서
 * 재는 값은 순환이 아니다 — 표가 그 줄들을 한 번도 본 적이 없다.
 */
function loadFitted(): ConfusionCosts | null {
  if (!existsSync(FITTED)) return null;
  return JSON.parse(readFileSync(FITTED, "utf8")) as ConfusionCosts;
}

/** 교차검증 접힘 수. 줄이 적어 5로 둔다 — 더 늘리면 접힘마다 배울 것이 남지 않는다. */
const FOLDS = 5;

interface Arm {
  name: string;
  config: MinUIConfig;
  /** 대안까지 볼 것인가. */
  nbest: boolean;
  /**
   * 들린 말 대신 <b>읽으라고 한 말</b>을 넣는다.
   *
   * <p>기준선이다 — 같은 문장을 손으로 쳤다면 몇 %인가. 이것과 ①의 차이가
   * <b>STT 채널이 깎아먹는 몫</b>이고, 이 마일스톤이 되찾으려는 것의 크기다.
   */
  useIntended?: boolean;
}

function withSearch(patch: Partial<MinUIConfig["search"]>): MinUIConfig {
  return { ...DEFAULT_CONFIG, search: { ...DEFAULT_CONFIG.search, ...patch } };
}

interface Score {
  answered: number;
  top1: number;
  top3: number;
  reprompt: number;
  /** 답이 없어야 하는데 자신 있게 연 것. */
  wrongConfident: number;
  negatives: number;
  misses: string[];
  elapsed: number[];
}

function blank(): Score {
  return {
    answered: 0,
    top1: 0,
    top3: 0,
    reprompt: 0,
    wrongConfident: 0,
    negatives: 0,
    misses: [],
    elapsed: [],
  };
}

function hypothesesOf(row: CorpusRow, arm: Arm): { text: string }[] {
  if (arm.useIntended === true) return [{ text: row.intended }];
  if (!arm.nbest || row.alternatives.length === 0) return [{ text: row.heard }];
  return row.alternatives.map((text) => ({ text }));
}

function runArm(arm: Arm, rows: readonly CorpusRow[]): Score {
  const score = blank();

  /*
   * **재기 전에 데운다.** 파이프라인을 처음 만들 때 n-gram 색인을 짓는데(사이트당
   * 수천 개 문서), 그 비용이 첫 질의의 시간에 통째로 얹힌다. 데우지 않고 쟀더니
   * 발음 표기를 켠 구성이 8배 느려 보였다 — 실제로는 색인을 처음 지은 것뿐이었다.
   * 게이트가 보려는 것은 <b>질의 하나가 더 쓰는 시간</b>이다.
   */
  for (const site of ALL_SITES) {
    const pipeline = pipelineFor(site, arm.config, arm.name);
    pipeline?.searchHypotheses([{ text: "잔액" }]);
  }

  for (const row of rows) {
    const hypotheses = hypothesesOf(row, arm);

    if (row.expect === undefined) {
      /*
       * 답이 없어야 하는 질의는 **모든 카탈로그에** 걸어 본다. 한 곳에서만 재면
       * 임계값을 내릴수록 좋아 보이는 착시가 생긴다 (§12.6).
       */
      for (const site of ALL_SITES) {
        const pipeline = pipelineFor(site, arm.config, arm.name);
        if (!pipeline) continue;
        score.negatives += 1;
        const result = pipeline.searchHypotheses(hypotheses);
        if (result.status === "ok") {
          score.wrongConfident += 1;
          score.misses.push(
            `잘못된 확신  ${site}  "${row.heard}" → ${result.candidates[0]!.menuId}`,
          );
        }
      }
      continue;
    }

    const pipeline = pipelineFor(row.site, arm.config, arm.name);
    if (!pipeline) continue;

    score.answered += 1;
    const started = performance.now();
    const result = pipeline.searchHypotheses(hypotheses);
    score.elapsed.push(performance.now() - started);

    if (result.status === "unclear") {
      score.reprompt += 1;
      score.misses.push(`되묻기  "${row.intended}" → 들림 "${row.heard}" (정답 ${row.expect})`);
      continue;
    }

    const ids = result.candidates.map((candidate) => candidate.menuId);
    if (isAnswer(row.site, ids[0]!, row.expect)) score.top1 += 1;
    else if (ids.some((id) => isAnswer(row.site, id, row.expect!))) {
      score.top3 += 1;
      score.misses.push(`2~3순위  "${row.intended}" → 들림 "${row.heard}" (정답 ${row.expect})`);
    } else {
      score.misses.push(
        `오답    "${row.intended}" → 들림 "${row.heard}" → ${ids[0]} (정답 ${row.expect})`,
      );
    }
  }

  return score;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "  —  ";
  return `${((100 * part) / whole).toFixed(1)}%`;
}

function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

function report(label: string, rows: readonly CorpusRow[], arms: readonly Arm[]): Score[] {
  console.log(`\n  ${label} — ${rows.length}줄`);

  const recognized = rows.filter(isRecognized);
  const lost = rows.length - recognized.length;
  if (lost > 0) {
    console.log(`    인식 자체가 실패한 줄 ${lost} — 검색 이전의 문제라 아래 표에서 뺐다`);
  }
  if (recognized.length === 0) {
    console.log("    잴 것이 없다.");
    return arms.map(() => blank());
  }

  const scores = arms.map((arm) => runArm(arm, recognized));

  console.log("\n    구성                 1순위    후보3    되묻기   잘못된확신   p95");
  arms.forEach((arm, i) => {
    const score = scores[i]!;
    console.log(
      `    ${arm.name.padEnd(20)}` +
        `${pct(score.top1, score.answered).padStart(6)}  ` +
        `${pct(score.top1 + score.top3, score.answered).padStart(6)}  ` +
        `${pct(score.reprompt, score.answered).padStart(6)}  ` +
        `${String(score.wrongConfident).padStart(8)}/${score.negatives}  ` +
        `${p95(score.elapsed).toFixed(2)}ms`,
    );
  });

  return scores;
}

function main(): void {
  const corpus = loadCorpus();
  if (!corpus) {
    explainMissingCorpus();
    process.exitCode = 1;
    return;
  }

  const sound = { ...DEFAULT_CONFIG.search.phonology, enabled: true };
  const withNbest = { ...DEFAULT_CONFIG.search.nbest, enabled: true };

  /*
   * **기준선을 기본값에 기대지 않는다.** M21을 켜면서 `DEFAULT_CONFIG`가 바뀌었고,
   * 그대로 두면 「지금」이 「M21을 켠 것」과 같아져 벤치가 자기 자신과 비교하게 된다.
   * 실제로 한 번 그렇게 나왔다 — 상승폭이 8.2%p에서 4.1%p로 접혔다.
   */
  const before: MinUIConfig = withSearch({
    phonology: { ...DEFAULT_CONFIG.search.phonology, enabled: false },
    confusion: UNIFORM_COSTS,
    nbest: { ...DEFAULT_CONFIG.search.nbest, enabled: false },
  });

  /*
   * **배운 파라미터가 없는 구성만 여기 있다.** 혼동 비용이 붙는 구성은 같은 줄로
   * 배우고 같은 줄로 재면 안 되므로 아래 교차검증에서 따로 판정한다.
   */
  const fitted = loadFitted() ?? UNIFORM_COSTS;

  const arms: Arm[] = [
    { name: "⓪ 글로 쳤다면", config: before, nbest: false, useIntended: true },
    { name: "① M21 이전", config: before, nbest: false },
    {
      name: "② +발음 표기",
      config: withSearch({ phonology: sound, confusion: UNIFORM_COSTS }),
      nbest: false,
    },
    {
      name: "③ +혼동 비용",
      config: withSearch({ phonology: sound, confusion: fitted }),
      nbest: false,
    },
    {
      name: "④ +대안(N-best)",
      config: withSearch({ phonology: sound, confusion: fitted, nbest: withNbest }),
      nbest: true,
    },
  ];

  console.log("\n── 음성 경로 벤치 (M21) ──────────────────────────────────");
  console.log(`\n  코퍼스 ${corpus.rows.length}줄 · 수집일 ${corpus.collectedAt ?? "미상"}`);

  const bySource = new Map<Source, CorpusRow[]>();
  for (const row of corpus.rows) {
    const bucket = bySource.get(row.source);
    if (bucket) bucket.push(row);
    else bySource.set(row.source, [row]);
  }

  console.log("\n  출처별 표본 — **평균내지 않는다** (docs/평가세트-프로토콜.md)");
  for (const [source, rows] of bySource) {
    const speakers = new Set(rows.map((row) => row.speaker)).size;
    console.log(`    ${source.padEnd(22)} ${String(rows.length).padStart(4)}줄 · 화자 ${speakers}`);
  }

  const train = corpus.rows.filter((row) => TRAIN_SOURCES.includes(row.source));
  const holdout = corpus.rows.filter((row) => HOLDOUT_SOURCES.includes(row.source));

  const trainScores = report("학습 층위 (비용을 여기서 배웠다 — 부풀려져 있다)", train, arms);
  const holdoutScores = report("홀드아웃 — 다른 사람의 발화. 판정은 이것으로 한다", holdout, arms);

  const judged = holdout.length > 0 ? holdoutScores : trainScores;
  const judgedOn = holdout.length > 0 ? "홀드아웃" : "학습 층위(홀드아웃 없음 — 잠정)";

  const base = judged[1]!;
  const best = judged[4]!;
  const lift =
    base.answered === 0
      ? 0
      : (100 * best.top1) / best.answered - (100 * base.top1) / base.answered;
  const extraConfident = best.wrongConfident - base.wrongConfident;
  const latency = p95(best.elapsed) - p95(base.elapsed);

  console.log(`\n── 사전 등록 게이트 판정 (${judgedOn}) ────────────────────\n`);
  const line = (ok: boolean, text: string) => console.log(`    ${ok ? "통과" : "미달"}  ${text}`);
  line(lift >= GATE.top1Lift, `1순위 상승 ${lift.toFixed(1)}%p  (기준 +${GATE.top1Lift}%p)`);
  line(
    extraConfident <= GATE.worseConfident,
    `잘못된 확신 증가 ${extraConfident}건  (기준 ${GATE.worseConfident}건)`,
  );
  line(latency <= GATE.p95Ms, `추가 지연 p95 ${latency.toFixed(2)}ms  (기준 ${GATE.p95Ms}ms)`);
  console.log(
    `    별도    텍스트 회귀 ${GATE.textRegression}건 — bench:search·bench:sites로 확인한다`,
  );

  const passed =
    lift >= GATE.top1Lift && extraConfident <= GATE.worseConfident && latency <= GATE.p95Ms;

  console.log(
    passed
      ? "\n  게이트 통과 — config.ts의 phonology.enabled·nbest.enabled를 켠다.\n"
      : "\n  게이트 미달 — 켜지 않는다. 수치를 docs/기획안.md §16에 적는다.\n",
  );

  /*
   * 홀드아웃이 있으면 판정은 위에서 끝났다. 교차검증은 **홀드아웃이 없을 때만** 쓰는
   * 대체 수단이므로 여기서 다시 돌리지 않는다 — 두 판정을 나란히 내면 마음에 드는
   * 쪽을 고르게 된다.
   */
  if (holdout.length === 0) crossValidate(corpus.rows, arms[4]!, base);

  if (best.misses.length > 0) {
    console.log(`  ④가 놓친 것 (최대 25):`);
    console.log(best.misses.slice(0, 25).map((miss) => `    ${miss}`).join("\n"));
    console.log("");
  }
}

main();

/**
 * 혼동 비용을 <b>못 본 줄에서</b> 판정한다.
 *
 * <p>화자가 하나뿐이라 프로토콜이 요구하는 홀드아웃을 만들 수 없다. 그렇다고 같은 줄로
 * 배우고 같은 줄로 재면 그 수치는 §16이 기록한 순환과 같은 것이 된다. 그래서 코퍼스를
 * 다섯 조각으로 나누고, 네 조각에서 배운 표로 <b>남은 한 조각</b>만 채점한다.
 *
 * <p><b>이것이 답하지 못하는 것을 적어 둔다.</b> 교차검증은 "같은 줄로 배우고 쟀다"를
 * 없애 줄 뿐, <b>화자가 바뀌어도 되는가</b>에는 답하지 못한다. 그 답은 다른 사람의
 * 발화(`thirdparty-recorded`)에서만 나온다.
 */
function crossValidate(rows: readonly CorpusRow[], base: Arm, gateBase: Score): void {
  const answerable = rows.filter((row) => isRecognized(row) && row.expect !== undefined);
  const negatives = rows.filter((row) => isRecognized(row) && row.expect === undefined);
  if (answerable.length < FOLDS * 2) {
    console.log("  교차검증: 줄이 모자라 건너뛴다.\n");
    return;
  }

  console.log("── 혼동 비용 교차검증 (홀드아웃이 없어 이 방법으로 판정한다) ────\n");

  let withCosts = 0;
  let without = 0;
  let learned = 0;
  const elapsed: number[] = [];

  for (let fold = 0; fold < FOLDS; fold++) {
    const test = answerable.filter((_, index) => index % FOLDS === fold);
    const train = answerable.filter((_, index) => index % FOLDS !== fold);
    const { costs } = fitCosts(train);
    learned += Object.keys(costs.subs).length;

    const armWith: Arm = {
      ...base,
      name: `cv-${fold}-with`,
      config: withSearch({ ...base.config.search, confusion: costs }),
    };
    const scored = runArm(armWith, test);
    withCosts += scored.top1;
    elapsed.push(...scored.elapsed);
    without += runArm({ ...base, name: `cv-${fold}-without` }, test).top1;
  }

  /*
   * 답이 없어야 할 질의는 **학습에 한 번도 쓰이지 않았다** — 위 접힘은 정답이 있는 줄만
   * 배운다. 그래서 전체에서 배운 표로 한 번만 재도 순환이 아니다.
   */
  const { costs: full } = fitCosts(answerable);
  const negativeArm: Arm = {
    ...base,
    name: "cv-negatives",
    config: withSearch({ ...base.config.search, confusion: full }),
  };
  const negativeScore = runArm(negativeArm, negatives);

  const total = answerable.length;
  const delta = (100 * (withCosts - without)) / total;
  const share = (value: number) => `${value}/${total}  ${((100 * value) / total).toFixed(1)}%`;

  console.log(
    `    접힘 ${FOLDS}개 · 채점한 줄 ${total} · 접힘당 배운 치환 평균 ${(learned / FOLDS).toFixed(1)}`,
  );
  console.log(`    비용표 없이   ${share(without)}`);
  console.log(`    비용표 넣고   ${share(withCosts)}`);
  console.log(`    차이          ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%p\n`);

  const lift = (100 * withCosts) / total - (100 * gateBase.top1) / gateBase.answered;
  const extraConfident = negativeScore.wrongConfident - gateBase.wrongConfident;
  const latency = p95(elapsed) - p95(gateBase.elapsed);

  console.log("── 전체 구성 게이트 판정 (교차검증 기준) ──────────────────\n");
  const line = (ok: boolean, text: string) => console.log(`    ${ok ? "통과" : "미달"}  ${text}`);
  line(lift >= GATE.top1Lift, `1순위 상승 ${lift.toFixed(1)}%p  (기준 +${GATE.top1Lift}%p)`);
  line(
    extraConfident <= GATE.worseConfident,
    `잘못된 확신 ${negativeScore.wrongConfident}/${negativeScore.negatives}건 · 증가 ${extraConfident}건  (기준 ${GATE.worseConfident}건)`,
  );
  line(latency <= GATE.p95Ms, `추가 지연 p95 ${latency.toFixed(2)}ms  (기준 ${GATE.p95Ms}ms)`);

  const passed =
    lift >= GATE.top1Lift && extraConfident <= GATE.worseConfident && latency <= GATE.p95Ms;
  console.log(
    passed
      ? "\n  전체 구성 게이트 통과. 다만 화자가 하나뿐이라 **화자 일반화는 아직 미검증**이다 —\n  다른 사람의 발화로 다시 재기 전에는 잠정이다.\n"
      : "\n  전체 구성도 게이트를 넘지 못했다. 켜지 않는다.\n",
  );
}
