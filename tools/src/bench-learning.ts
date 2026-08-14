import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  LearnedTerms,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  normalize,
  type MenuCatalog,
} from "@minui/core";

/**
 * 개인 동의어 학습(M7)이 무엇을 얻고 무엇을 잃는가.
 *
 * <h3>재지 않는 것</h3>
 * <p><b>"배운 말을 다시 물으면 맞힌다"는 재지 않는다.</b> 그 문장을 그대로 적어 두고
 * 그 문장으로 묻는 것이니 100%가 나오는 게 당연하고, 당연한 것을 세면 측정이 아니라
 * 동어반복이다. 이 프로젝트는 그런 숫자를 한 번 만든 적이 있다 — 실패한 질의를 보고
 * 동의어를 고친 뒤 그 질의로 잰 85%다(`docs/기획안.md` §16).
 *
 * <h3>재는 것</h3>
 * <p>이 기능의 진짜 위험은 <b>배운 것이 나머지를 망치는 것</b>이다. 같은 문서에 기록된
 * 사고가 정확히 그 모양이었다 — LLM 동의어를 전 메뉴에 얹었더니 85%가 67%로 떨어졌다.
 * 표현을 하나 더할 때마다 그것이 다른 질의의 답을 밀어낼 수 있기 때문이다.
 *
 * <ol>
 *   <li><b>간섭</b> — 놓친 질의를 전부 배운 뒤, <b>배우지 않은</b> 질의의 정확도가 떨어지는가
 *   <li><b>오학습</b> — 사용자가 <b>엉뚱한 메뉴</b>를 골라 잘못 배웠을 때 나머지가 망가지는가
 *   <li><b>돌아갈 길</b> — 잘못 배운 <b>그 질의 자체</b>에서 정답이 후보에 남는가
 *   <li><b>거절</b> — 답이 없어야 하는 질의 20건을 학습 뒤에도 여전히 되묻는가
 * </ol>
 *
 * <p>이득은 자명하고 대가는 자명하지 않으므로, 재야 하는 것은 대가 쪽이다.
 *
 * <p><b>③은 처음에 빠뜨렸던 항목이다.</b> ①②가 "배우지 않은 다른 질의"만 보는 바람에,
 * 정작 잘못 배운 그 질의가 어떻게 되는지를 아무도 재지 않았다. 그 자리에 실제 결함이
 * 있었다 — 학습을 정확 매칭과 같은 독점 단계로 뒀더니 오학습 한 번에 정답이 후보에서
 * 통째로 사라졌다. 측정이 비추지 않는 곳에 결함이 있었던 셈이라, 항목을 늘려 굳혀 둔다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;

interface Case {
  query: string;
  expect: string;
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
) as { sites: Record<string, Case[]>; negative: string[] };

/** 학습 상태를 갈아 끼울 수 있는 파이프라인. 색인과 임베딩은 한 번만 만든다. */
function bench(catalog: MenuCatalog) {
  const index = new MenuIndex(catalog);
  const embedding = NgramTfIdfProvider.build(index.documents());
  const labelOf = (id: string) => catalog.find((menu) => menu.id === id)?.label ?? "";
  const idOf = (label: string) => catalog.find((menu) => menu.label === label)?.id;

  return {
    idOf,
    /** @param learned 이 기기가 배웠다고 칠 표현들 */
    run(cases: readonly Case[], learned?: LearnedTerms) {
      const pipeline = new SearchPipeline(index, DEFAULT_CONFIG, embedding, learned);
      let top1 = 0;
      const missed: Case[] = [];

      for (const testCase of cases) {
        const result = pipeline.search(testCase.query);
        const first = result.status === "ok" ? labelOf(result.candidates[0]!.menuId) : null;
        if (first === testCase.expect) top1 += 1;
        else missed.push(testCase);
      }
      return { top1, total: cases.length, missed };
    },
    /** 이 질의의 후보 안에 정답이 들어 있는가. 1순위가 아니어도 사용자는 거기서 고를 수 있다. */
    answerInCandidates(testCase: Case, learned?: LearnedTerms): boolean {
      const pipeline = new SearchPipeline(index, DEFAULT_CONFIG, embedding, learned);
      const result = pipeline.search(testCase.query);
      if (result.status !== "ok") return false;
      return result.candidates.some((c) => labelOf(c.menuId) === testCase.expect);
    },
    /** 답이 없어야 하는 질의를 옳게 되물었는가. */
    refusals(queries: readonly string[], learned?: LearnedTerms) {
      const pipeline = new SearchPipeline(index, DEFAULT_CONFIG, embedding, learned);
      return queries.filter((query) => pipeline.search(query).status === "unclear").length;
    },
  };
}

/** 사용자가 이 표현으로 저 메뉴에 끝내 도달했다고 친다. */
function taught(pairs: { query: string; menuId: string }[]): LearnedTerms {
  return new LearnedTerms(
    DEFAULT_CONFIG,
    pairs.map(({ query, menuId }) => ({
      term: normalize(query),
      menuId,
      count: 1,
      lastAt: 0,
    })),
  );
}

interface Row {
  site: string;
  /** 배우지 않은 질의 수 */
  held: number;
  heldBefore: number;
  heldAfter: number;
  /** 오학습 뒤 같은 질의들 */
  heldPoisoned: number;
  refusedBefore: number;
  refusedAfter: number;
  refusedPoisoned: number;
  learnedCount: number;
  /** 배운 질의 자체 — 학습 전 후보 안에 정답이 있던 건수 */
  reachableBefore: number;
  /** 그중 오학습 뒤에도 정답이 후보에 남은 건수 */
  reachablePoisoned: number;
}

const rows: Row[] = [];
const negatives = querySet.negative;

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;

  const cases = querySet.sites[site] ?? [];
  const harness = bench(catalog);

  // ① 지금 상태. 놓친 질의가 학습 대상이 된다.
  const base = harness.run(cases);
  const missed = base.missed.filter((c) => harness.idOf(c.expect) !== undefined);

  /*
   * **배우지 않은 질의만 남긴다.** 배운 것을 그대로 다시 묻는 것은 재지 않는다.
   * 여기 남는 것이 "학습이 나를 방해했는가"를 답할 수 있는 유일한 문항들이다.
   */
  const held = cases.filter((c) => !missed.includes(c));

  const learned = taught(
    missed.map((c) => ({ query: c.query, menuId: harness.idOf(c.expect)! })),
  );

  /*
   * 오학습 — 사용자가 후보를 훑다가 **엉뚱한 것**을 눌렀다고 친다. 실제로 일어나는 일이고,
   * 이 기능이 가장 나쁘게 틀릴 수 있는 방식이다. 정답이 아닌 메뉴 중 첫 번째를 준다.
   */
  const poisoned = taught(
    missed.map((c) => {
      const wrong = catalog.find((menu) => menu.label !== c.expect)!;
      return { query: c.query, menuId: wrong.id };
    }),
  );

  /*
   * 잘못 배운 그 질의에서 사용자가 정답으로 돌아갈 수 있는가.
   * 후보에 남아 있으면 눌러서 바로잡을 수 있고, 그러면 올바른 짝이 학습된다.
   */
  const reachable = missed.filter((c) => harness.answerInCandidates(c));
  const reachableStill = reachable.filter((c) => harness.answerInCandidates(c, poisoned));

  rows.push({
    site,
    reachableBefore: reachable.length,
    reachablePoisoned: reachableStill.length,
    held: held.length,
    heldBefore: harness.run(held).top1,
    heldAfter: harness.run(held, learned).top1,
    heldPoisoned: harness.run(held, poisoned).top1,
    refusedBefore: harness.refusals(negatives),
    refusedAfter: harness.refusals(negatives, learned),
    refusedPoisoned: harness.refusals(negatives, poisoned),
    learnedCount: missed.length,
  });
}

const sum = (pick: (row: Row) => number) => rows.reduce((total, row) => total + pick(row), 0);

console.log("\n개인 동의어 학습 — 배운 것이 나머지를 망치는가 (M7)\n");
console.log("  배우지 않은 질의의 1순위 정확도. 셋이 같아야 한다.\n");
console.log("  사이트        배운말  대조군   학습후   오학습후");
console.log("  ─────────────────────────────────────────────────");
for (const row of rows) {
  const cell = (n: number) => `${n}/${row.held}`.padStart(7);
  console.log(
    `  ${row.site.padEnd(12)}${String(row.learnedCount).padStart(5)}` +
      `${cell(row.heldBefore)}${cell(row.heldAfter)}${cell(row.heldPoisoned)}`,
  );
}

const held = sum((r) => r.held);
console.log("  ─────────────────────────────────────────────────");
console.log(
  `  ${"합계".padEnd(11)}${String(sum((r) => r.learnedCount)).padStart(5)}` +
    `${`${sum((r) => r.heldBefore)}/${held}`.padStart(7)}` +
    `${`${sum((r) => r.heldAfter)}/${held}`.padStart(7)}` +
    `${`${sum((r) => r.heldPoisoned)}/${held}`.padStart(7)}`,
);

console.log(`\n  답 없는 질의 ${negatives.length}건을 옳게 되물었는가 (사이트별)\n`);
console.log("  사이트        대조군   학습후   오학습후");
console.log("  ─────────────────────────────────────────");
for (const row of rows) {
  const cell = (n: number) => `${n}/${negatives.length}`.padStart(9);
  console.log(
    `  ${row.site.padEnd(12)}${cell(row.refusedBefore)}${cell(row.refusedAfter)}` +
      `${cell(row.refusedPoisoned)}`,
  );
}

const drift = sum((r) => r.heldBefore) - sum((r) => r.heldAfter);
const poisonDrift = sum((r) => r.heldBefore) - sum((r) => r.heldPoisoned);
const refusalDrift = sum((r) => r.refusedBefore) - sum((r) => r.refusedPoisoned);

console.log("\n  잘못 배운 그 질의에서 정답으로 돌아갈 수 있는가\n");
console.log("  사이트        후보에 정답 있던 질의   오학습 뒤에도 남음");
console.log("  ─────────────────────────────────────────────────────");
for (const row of rows) {
  console.log(
    `  ${row.site.padEnd(12)}${String(row.reachableBefore).padStart(15)}` +
      `${String(row.reachablePoisoned).padStart(20)}`,
  );
}
const reachable = sum((r) => r.reachableBefore);
const reachableStill = sum((r) => r.reachablePoisoned);
console.log("  ─────────────────────────────────────────────────────");
console.log(
  `  ${"합계".padEnd(11)}${String(reachable).padStart(15)}${String(reachableStill).padStart(20)}`,
);
console.log(
  "\n    후보에 남아 있으면 사용자가 눌러 바로잡을 수 있고, 그때 올바른 짝이 학습된다.",
);
console.log("    0이 되면 잘못 배운 말에서 빠져나갈 길이 없다 — 한 번 그렇게 만든 적이 있다.");

console.log("\n  읽는 법");
console.log("    세 열이 같으면 학습이 다른 질의를 건드리지 않는다는 뜻이다.");
console.log("    학습 표현은 **정확히 같은 말일 때만** 걸리므로 그렇게 설계돼 있고,");
console.log("    이 표는 설계가 실제로 그렇게 도는지를 확인한다.\n");
console.log(`    학습으로 잃은 질의   ${drift}건`);
console.log(`    오학습으로 잃은 질의 ${poisonDrift}건`);
console.log(`    오학습으로 잃은 거절 ${refusalDrift}건\n`);

if (drift !== 0 || poisonDrift !== 0 || refusalDrift !== 0) {
  console.log("    ⚠ 0이 아니다. 학습이 다른 질의를 밀어내고 있다 — 설계를 다시 봐야 한다.\n");
}
