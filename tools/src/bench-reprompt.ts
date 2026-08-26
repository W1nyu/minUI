import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  mergeNeural,
  NgramTfIdfProvider,
  SearchPipeline,
  buildReprompt,
  resolveConfig,
  type MenuCatalog,
} from "@minui/core";
import { createEncoders } from "../../services/matcher/src/encoder.js";
import { cosineTopK, type VectorIndex } from "../../services/matcher/src/vectors.js";

/**
 * 되묻기가 길잡이가 되는가 (M11 Task 19).
 *
 * <p>기획안 §9.2가 남긴 것:
 * <blockquote>되묻기 선택지 개수는 아직 못 정했다. 신한은행의 카테고리가 36개인데 3개만
 * 보여 주면 길잡이가 되지 못하고, 10개로 늘리면 그 화면이 다시 탐색 문제가 된다.
 * 사용 빈도 상위 카테고리를 고르는 것이 옳은 방향으로 보이지만 사용자 테스트 없이
 * 확정할 수 없다.</blockquote>
 *
 * <p>사용자 테스트 없이 <b>확정</b>할 수 없다는 것은 지금도 맞다. 다만 <b>기계적인 무릎이
 * 어디인지</b>는 잴 수 있다 — 새 지표는 <b>되묻기 뒤 도달률</b>: 되묻기로 끝난 질의 중
 * 정답이 내놓은 선택지 안에 들어 있는 비율.
 *
 * <p>오염과 무관하다. 이 지표는 "정답 메뉴가 어느 묶음에 속하는가"만 보므로,
 * 질의와 정답의 글자가 겹치는지와 상관이 없다.
 *
 * <h3>도달률만 보면 안 된다 — 실측으로 배웠다</h3>
 * 처음에는 도달률만 찍었는데 <b>정적 선택지가 60%, 가른 것이 22%</b>로 나왔다.
 * 정적 쪽이 이긴 이유는 좋아서가 아니라 <b>카테고리가 커서</b>다 — `개인뱅킹` 하나가
 * 카탈로그 절반을 담으면 정답은 당연히 그 안에 있다. 그리고 그것이 정확히 §9.2가
 * "길잡이가 되지 못한다"고 한 상태다.
 *
 * <p>그래서 <b>고른 뒤 훑어야 할 메뉴 수</b>를 함께 찍는다. 도달했는데 300개를 훑어야
 * 하면 도달한 것이 아니다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;

interface Case { query: string; expect: string; menuId: string; site: string }
const clean = (
  JSON.parse(readFileSync(join(HERE, "../fixtures/neural-queries.json"), "utf8")) as { cases: Case[] }
).cases;
const negatives = (
  JSON.parse(readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8")) as { negative: string[] }
).negative;

/** 지금까지의 되묻기 — 질의를 안 보고 카테고리 앞에서 자른다. */
function staticChoices(index: MenuIndex, count: number) {
  return index.categories().slice(0, count).map((label) => ({
    label,
    menuIds: index.menus.filter((m) => m.categoryLabel === label).map((m) => m.menuId),
  }));
}

/*
 * 원격 후보를 미리 뽑아 둔다. 모델을 세 번(선택지 3·4·5) 돌릴 이유가 없다 —
 * 후보는 선택지 수와 무관하다.
 */
const { query: encoder } = await createEncoders({ modelDir: join(HERE, "../models") });
const remote = new Map<string, { menuId: string; score: number }[]>();
const vindexes = new Map<string, VectorIndex>();

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;
  const meta = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/vectors/${site}.json`), "utf8"),
  ) as { dim: number; menuIds: string[]; scale: number[] };
  const bin = readFileSync(join(HERE, `../../demos/src/vectors/${site}.bin`));
  const vindex: VectorIndex = {
    version: 1, dim: meta.dim, menuIds: meta.menuIds,
    scale: Float32Array.from(meta.scale),
    data: new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength),
  };
  vindexes.set(site, vindex);
  void catalog;

  for (const c of clean.filter((x) => x.site === site)) {
    const v = await encoder.encode(c.query);
    remote.set(c.query, cosineTopK(v, vindex, 20));
  }
}

console.log(`
  되묻기 뒤 도달률 — §9.2가 못 정한 것을 숫자로 (M11)
  ${"─".repeat(70)}

  되묻기로 끝난 질의 중, **정답이 내놓은 선택지 안에 있는** 비율.
  오염과 무관한 지표다 — 정답이 어느 묶음에 속하는지만 본다.
`);

for (const count of [3, 4, 5]) {
  const config = resolveConfig({ search: { reprompt: { choiceCount: count } } });
  let reprompted = 0, staticHit = 0, smartHit = 0;
  let staticScan = 0, smartScan = 0;
  let negNoisy = 0;

  for (const site of SITES) {
    const catalog = JSON.parse(
      readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
    ) as MenuCatalog;
    const ov = JSON.parse(
      readFileSync(join(HERE, `../catalogs/${site}.overrides.json`), "utf8"),
    ) as Record<string, { synonyms?: string[] }>;
    const shaped = catalog.map((m) => ({ ...m, synonyms: ov[m.id]?.synonyms ?? [] }));

    const index = new MenuIndex(shaped);
    const pipeline = new SearchPipeline(index, config, NgramTfIdfProvider.build(index.documents()));
    const fallback = staticChoices(index, count);

    for (const c of clean.filter((x) => x.site === site)) {
      /*
       * **원격 후보를 넣고 잰다.** 이 기능의 전제가 "가를 대상이 신경망이 회수한 후보"라,
       * 로컬만으로 재면 가를 것이 없는 상태를 재게 된다.
       */
      const outcome = pipeline.searchMerged(c.query, remote.get(c.query) ?? []);
      if (outcome.status !== "unclear") continue;
      reprompted += 1;

      const hitStatic = fallback.find((g) => g.menuIds.includes(c.menuId));
      if (hitStatic) { staticHit += 1; staticScan += hitStatic.menuIds.length; }

      const hitSmart = outcome.choices.find((g) => g.menuIds.includes(c.menuId));
      if (hitSmart) { smartHit += 1; smartScan += hitSmart.menuIds.length; }
    }

    /*
     * 답이 없어야 하는 질의에 그럴듯한 선택지를 내미는 것도 잘못된 확신이다.
     * 가른 선택지가 카테고리 기본값과 다르면 "무언가 찾은 척"한 것으로 센다.
     */
    for (const q of negatives) {
      const outcome = pipeline.search(q);
      if (outcome.status !== "unclear") continue;
      const labels = outcome.choices.map((g) => g.label).join("|");
      if (labels !== fallback.map((g) => g.label).join("|")) negNoisy += 1;
    }
  }

  const pct = (n: number) => (reprompted === 0 ? "—" : `${((n / reprompted) * 100).toFixed(1)}%`);
  const scan = (hits: number, sum: number) => (hits === 0 ? "—" : `${Math.round(sum / hits)}개`);
  console.log(`  선택지 ${count}개   되묻기 ${String(reprompted).padStart(4)}건`);
  console.log(`     ${" ".repeat(22)}도달률      고른 뒤 훑을 메뉴`);
  console.log(`     지금 (카테고리 앞 ${count}개) ${pct(staticHit).padStart(7)}  ${scan(staticHit, staticScan).padStart(14)}`);
  console.log(`     후보를 가른 것         ${pct(smartHit).padStart(7)}  ${scan(smartHit, smartScan).padStart(14)}`);
  console.log(`     부정 질의에 기본값과 다른 선택지  ${negNoisy}건 / ${negatives.length * SITES.length}\n`);
}

console.log(`  ${"─".repeat(70)}
  §9.2는 "사용자 테스트 없이 확정할 수 없다"고 적었고 그것은 지금도 맞다.
  여기 있는 것은 **기계적인 무릎**이지 사람이 어느 쪽을 쉬워하는지가 아니다.
`);
