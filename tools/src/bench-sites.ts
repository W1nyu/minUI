import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  type MenuCatalog,
  type MenuItem,
} from "@minui/core";

/**
 * 동의어를 누가 붙였을 때 가장 잘 찾는가.
 *
 * <p>이 프로젝트의 모든 정확도 수치에는 같은 흠이 있었다 — 질의도 내가 쓰고 동의어도 내가
 * 썼고, 나중에는 <b>어느 질의가 실패했는지 보고 나서</b> 동의어를 고쳤다. 그렇게 얻은
 * 숫자는 상한선이지 추정치가 아니다.
 *
 * <p><b>LLM 동의어는 구조적으로 깨끗하다.</b> 모델은 질의 세트를 보지 않고 라벨과 경로만
 * 보고 만들었다. 그래서 이 비교는 이 프로젝트에서 처음으로 자기 채점이 아니다.
 *
 * <ul>
 *   <li><b>A 라벨만</b> — 동의어 없음. 바닥
 *   <li><b>B 사람</b> — 내가 씀. 일부는 실패를 보고 고쳤다(오염)
 *   <li><b>C LLM</b> — 라벨·경로만 보고 생성 (<b>오염 없음</b>)
 *   <li><b>D 사람+LLM</b> — 겹치면 사람이 이긴다. 지금 카탈로그
 * </ul>
 *
 * <p>C가 B에 가까우면 사람 손 없이 이식된다는 뜻이고, 그것이 Studio의 성립 근거다.
 * C가 B에 못 미치면 그 격차가 사람이 여전히 해야 할 몫이다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;

/**
 * 사람 동의어를 실패를 보고 고친 곳. 여기서는 B가 부풀려져 있다.
 * KB국민·미래에셋은 서비스 대상에서 빠지면서 손대지 않아 비교가 공정하다.
 */
const HUMAN_TUNED = new Set<string>(["shinhan", "kbsec", "kebhana"]);

interface Case {
  query: string;
  expect: string;
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
) as { sites: Record<string, Case[]> };

type Mode = "A 라벨만" | "B 사람" | "C LLM" | "D 사람+LLM" | "E LLM(같은범위)";

/** 동의어 출처별로 카탈로그를 다시 만든다. 라벨·계층·위험도는 건드리지 않는다. */
function shape(
  catalog: MenuCatalog,
  mode: Mode,
  human: Map<string, string[]>,
  ai: Map<string, string[]>,
): MenuCatalog {
  return catalog.map((menu): MenuItem => {
    const pick = (): string[] => {
      switch (mode) {
        case "A 라벨만":
          return [];
        case "B 사람":
          return human.get(menu.id) ?? [];
        case "C LLM":
          return ai.get(menu.id) ?? [];
        case "D 사람+LLM":
          return human.get(menu.id) ?? ai.get(menu.id) ?? [];
        /*
         * 사람이 손댄 메뉴에만 LLM 것을 넣는다. **품질과 간섭을 갈라 보기 위한 구성이다.**
         *
         * 사람은 2,948개 중 121개에만 붙였고 그 121개가 질의의 정답이다. LLM은 전부에
         * 붙었으니 나머지 2,800개가 정답을 밀어낼 수 있다. E가 B에 가까우면 문제는
         * 동의어의 품질이 아니라 **어디에 붙이느냐**다.
         */
        case "E LLM(같은범위)":
          return human.has(menu.id) ? (ai.get(menu.id) ?? []) : [];
      }
    };
    return { ...menu, synonyms: pick() };
  });
}

function run(catalog: MenuCatalog, cases: readonly Case[]) {
  const index = new MenuIndex(catalog);
  const pipeline = new SearchPipeline(
    index,
    DEFAULT_CONFIG,
    NgramTfIdfProvider.build(index.documents()),
  );

  let top1 = 0;
  let top3 = 0;
  const misses: string[] = [];

  for (const testCase of cases) {
    const result = pipeline.search(testCase.query);
    if (result.status === "unclear") {
      misses.push(`되묻기  "${testCase.query}" → ${testCase.expect}`);
      continue;
    }
    const labels = result.candidates.map(
      (candidate) => catalog.find((menu) => menu.id === candidate.menuId)?.label ?? "",
    );
    if (labels[0] === testCase.expect) top1 += 1;
    else if (labels.includes(testCase.expect)) {
      top3 += 1;
      misses.push(`2~3순위 "${testCase.query}" 1순위=${labels[0]} → ${testCase.expect}`);
    } else {
      misses.push(`오답    "${testCase.query}" → ${labels[0]} (정답: ${testCase.expect})`);
    }
  }

  return { top1, top3, total: cases.length, misses };
}

/** 파일에서 id → 동의어. 사람 것과 LLM 것을 같은 모양으로 읽는다. */
function synonymsFrom(path: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      { synonyms?: string[] }
    >;
    for (const [id, value] of Object.entries(parsed)) {
      if (id.startsWith("_")) continue;
      if (value.synonyms && value.synonyms.length > 0) out.set(id, value.synonyms);
    }
  } catch {
    // 없으면 빈 채로 둔다 — 그 구성은 라벨만과 같아진다.
  }
  return out;
}

const MODES: Mode[] = ["A 라벨만", "B 사람", "C LLM", "D 사람+LLM", "E LLM(같은범위)"];

interface Row {
  site: string;
  mode: Mode;
  top1: number;
  top3: number;
  total: number;
}

const rows: Row[] = [];
const detail: string[] = [];

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;

  const human = synonymsFrom(join(HERE, `../catalogs/${site}.overrides.json`));
  const ai = synonymsFrom(join(HERE, `../catalogs/${site}.ai.json`));
  const cases = querySet.sites[site] ?? [];

  for (const mode of MODES) {
    const result = run(shape(catalog, mode, human, ai), cases);
    rows.push({ site, mode, top1: result.top1, top3: result.top3, total: result.total });
    if (mode === "C LLM" && result.misses.length > 0) {
      detail.push(`\n  ${site} — LLM만 썼을 때 놓친 것 ${result.misses.length}건`);
      for (const miss of result.misses) detail.push(`    ${miss}`);
    }
  }
}

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(0)}%`;
const cell = (site: string, mode: Mode) => {
  const row = rows.find((r) => r.site === site && r.mode === mode)!;
  return `${pct(row.top1, row.total)} (${pct(row.top1 + row.top3, row.total)})`;
};

console.log("\n  1회 질의 정확 매칭 (괄호는 후보 3개 안에 포함)\n");
console.log(`  ${"사이트".padEnd(12)}${MODES.map((mode) => mode.padStart(15)).join("")}`);

for (const site of SITES) {
  const mark = HUMAN_TUNED.has(site) ? " *" : "  ";
  console.log(
    `  ${(site + mark).padEnd(12)}${MODES.map((mode) => cell(site, mode).padStart(15)).join("")}`,
  );
}

const sum = (mode: Mode, sites: readonly string[]) => {
  const mine = rows.filter((row) => row.mode === mode && sites.includes(row.site));
  const top1 = mine.reduce((n, row) => n + row.top1, 0);
  const total = mine.reduce((n, row) => n + row.total, 0);
  return `${top1}/${total} ${pct(top1, total)}`;
};

const clean = SITES.filter((site) => !HUMAN_TUNED.has(site));

console.log(`\n  전체 5곳`);
for (const mode of MODES) console.log(`    ${mode.padEnd(12)} ${sum(mode, SITES)}`);
console.log(`\n  깨끗한 2곳 (${clean.join(" · ")}) — 사람 동의어를 실패 보고 고치지 않은 곳`);
for (const mode of MODES) console.log(`    ${mode.padEnd(12)} ${sum(mode, clean)}`);

console.log(
  `\n  * 표시한 세 곳은 사람 동의어를 실패를 보고 고쳤다. 그 B는 부풀려져 있다.` +
    `\n    C(LLM)는 다섯 곳 모두 질의를 보지 않고 만든 것이라 오염이 없다.`,
);

for (const line of detail) console.log(line);
console.log();
