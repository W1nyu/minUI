import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize, type MenuCatalog } from "@minui/core";
import {
  classifyLexicalSignal,
  overlap,
  type LexicalSignal,
} from "./eval-contamination.js";

/**
 * 평가 데이터의 용도와 문자열 신호를 보고한다.
 *
 * 문자열 겹침은 실제 발화를 버릴 사유가 아니다. `lexical-support`는 포함·동의어·n-gram
 * 경로의 회귀를, `semantic-focus`는 그 경로를 넘어선 의미 매칭의 추가 이득을 검증한다.
 * 두 결과는 섞지 않되 어느 쪽도 무효라고 부르지 않는다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;
const SETS = ["site-queries", "neural-queries"] as const;
type SetName = (typeof SETS)[number];

interface FixtureCase {
  query: string;
  expect?: string;
  menuId?: string;
  site: string;
  source?: string;
}

interface Row extends FixtureCase {
  label: string;
  synonyms: string[];
  unresolved: boolean;
  lexical: LexicalSignal;
  containment: number;
}

function selectedSet(argv: readonly string[]): SetName {
  const index = argv.indexOf("--set");
  if (index < 0) return "site-queries";
  const value = argv[index + 1];
  if (value === "site-queries" || value === "neural-queries") return value;
  console.error(`알 수 없는 평가 세트: ${value ?? "(값 없음)"}`);
  console.error(`사용법: pnpm --filter tools report:contamination -- --set <${SETS.join("|")}>`);
  process.exit(2);
}

function casesFor(name: SetName): FixtureCase[] {
  if (name !== "site-queries") {
    const fixture = JSON.parse(
      readFileSync(join(HERE, `../fixtures/${name}.json`), "utf8"),
    ) as { cases?: FixtureCase[] };
    return fixture.cases ?? [];
  }

  const fixture = JSON.parse(
    readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
  ) as { sites: Record<string, { query: string; expect: string }[]> };
  return SITES.flatMap((site) =>
    (fixture.sites[site] ?? []).map((item) => ({ ...item, site, source: "legacy-regression" })),
  );
}

function synonymsFrom(path: string): Map<string, string[]> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, { synonyms?: string[] }>;
    return new Map(
      Object.entries(parsed)
        .filter(([id, value]) => !id.startsWith("_") && (value.synonyms?.length ?? 0) > 0)
        .map(([id, value]) => [id, value.synonyms ?? []]),
    );
  } catch {
    return new Map();
  }
}

const catalogs = new Map<string, MenuCatalog>();
const overrides = new Map<string, Map<string, string[]>>();

function catalogFor(site: string): MenuCatalog {
  const cached = catalogs.get(site);
  if (cached) return cached;
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;
  catalogs.set(site, catalog);
  return catalog;
}

function overridesFor(site: string): Map<string, string[]> {
  const cached = overrides.get(site);
  if (cached) return cached;
  const loaded = synonymsFrom(join(HERE, `../catalogs/${site}.overrides.json`));
  overrides.set(site, loaded);
  return loaded;
}

function resolve(item: FixtureCase): Row {
  const catalog = catalogFor(item.site);
  const menu =
    (item.menuId ? catalog.find((candidate) => candidate.id === item.menuId) : undefined) ??
    catalog.find((candidate) => candidate.label === item.expect);
  if (!menu) {
    return {
      ...item,
      label: item.expect ?? item.menuId ?? "(정답을 찾지 못함)",
      synonyms: [],
      unresolved: true,
      lexical: "lexical-support",
      containment: 0,
    };
  }
  const synonyms = overridesFor(item.site).get(menu.id) ?? [];
  const signal = overlap(item.query, [menu.label, ...synonyms]);
  return {
    ...item,
    label: menu.label,
    synonyms,
    unresolved: false,
    lexical: classifyLexicalSignal(signal),
    containment: signal.containment,
  };
}

function pct(n: number, total: number): string {
  return total === 0 ? "0.0%" : `${((n / total) * 100).toFixed(1)}%`;
}

function sourceName(source: string | undefined): string {
  if (source === "legacy-regression") return "기존 회귀";
  if (source === "blind-paraphrase") return "블라인드 바꿔말하기";
  if (source === "thirdparty") return "제3자 발화";
  if (source === "usertest") return "사용자 테스트";
  return source ?? "출처 미기록";
}

function printLegacyDiagnostic(rows: readonly Row[]): void {
  const spaces = /\s+/g;
  let exact = 0;
  let raw3 = 0;
  let raw2 = 0;
  let norm2 = 0;
  for (const row of rows) {
    const raw = row.query.replace(spaces, "");
    const terms = row.synonyms.map((term) => term.replace(spaces, ""));
    const normalized = normalize(row.query);
    exact += Number(terms.some((term) => term === raw));
    raw3 += Number(terms.some((term) => term.length >= 3 && (raw.includes(term) || term.includes(raw))));
    raw2 += Number(terms.some((term) => term.length >= 2 && (raw.includes(term) || term.includes(raw))));
    norm2 += Number(row.synonyms.some((term) => {
      const normalizedTerm = normalize(term);
      return normalizedTerm.length >= 2 && (normalized.includes(normalizedTerm) || normalizedTerm.includes(normalized));
    }));
  }
  console.log("\n  ── 과거 세트의 문자열 신호 진단 (역사적 비교용)");
  console.log(`  동의어와 정확 일치                  ${String(exact).padStart(3)}건`);
  console.log(`  포함/포함 (3자 이상)                ${String(raw3).padStart(3)}건 ${pct(raw3, rows.length)}`);
  console.log(`  포함/포함 (2자 이상)                ${String(raw2).padStart(3)}건 ${pct(raw2, rows.length)}`);
  console.log(`  정규화 후 포함/포함 (2자 이상)      ${String(norm2).padStart(3)}건 ${pct(norm2, rows.length)}`);
  console.log("  이 값은 기존 회귀 세트가 문자 경로를 많이 포함한다는 뜻이다. 수치를 무효화하지 않으며,");
  console.log("  이 세트만으로 신경망의 추가 의미 매칭 효과를 주장하지 않는다는 제한만 붙는다.");
}

const set = selectedSet(process.argv.slice(2));
const rows = casesFor(set).map(resolve);
const resolved = rows.filter((row) => !row.unresolved);
const unresolved = rows.filter((row) => row.unresolved);
const semantic = resolved.filter((row) => row.lexical === "semantic-focus");
const lexical = resolved.filter((row) => row.lexical === "lexical-support");
const direct = resolved.filter((row) => row.containment === 1);

console.log("\n  평가 데이터 용도 보고 — 문자열 겹침은 폐기가 아니라 층위다");
console.log(`  ${"─".repeat(70)}`);
console.log(`\n  세트       ${set}`);
console.log(`  질의       ${rows.length}건 (정답 해석 실패 ${unresolved.length}건)`);
console.log(`\n  semantic-focus   ${String(semantic.length).padStart(4)}건 ${pct(semantic.length, resolved.length).padStart(7)}`);
console.log("                   문자·동의어 신호 없이 의미 매칭의 추가 이득을 볼 대조군");
console.log(`  lexical-support  ${String(lexical.length).padStart(4)}건 ${pct(lexical.length, resolved.length).padStart(7)}`);
console.log("                   실제 표현과 포함·동의어·n-gram 검색의 회귀를 볼 표본");
console.log(`  직접 포함 신호   ${String(direct.length).padStart(4)}건 ${pct(direct.length, resolved.length).padStart(7)}`);
console.log("                   lexical-support 안의 하위 정보 (무효 판정이 아님)");

const bySource = new Map<string, Row[]>();
for (const row of resolved) {
  const source = row.source ?? "unknown";
  const group = bySource.get(source) ?? [];
  group.push(row);
  bySource.set(source, group);
}
console.log("\n  ── 출처별 층위");
console.log("  출처                         전체  semantic-focus  lexical-support");
for (const [source, group] of bySource) {
  const count = group.filter((row) => row.lexical === "semantic-focus").length;
  console.log(`  ${sourceName(source).padEnd(28)} ${String(group.length).padStart(4)}  ${String(count).padStart(14)}  ${String(group.length - count).padStart(15)}`);
}

if (set === "site-queries") printLegacyDiagnostic(resolved);

console.log(`\n  ${"─".repeat(70)}`);
console.log("  사용 원칙");
console.log("  1. semantic-focus는 n-gram 대비 의미 매칭의 추가 이득에 쓴다.");
console.log("  2. lexical-support는 실제 표현을 포함한 검색 회귀·사용성에 쓴다.");
console.log("  3. 서로 다른 출처·층위를 평균내어 하나의 '의미 성능' 수치로 만들지 않는다.");
console.log(`  4. 이 세트의 정답은 ${unresolved.length === 0 ? "모두 현재 카탈로그에 연결됐다." : `${unresolved.length}건을 먼저 고쳐야 한다.`}`);
console.log("\n  다른 세트: pnpm --filter tools report:evaluation -- --set neural-queries\n");

if (unresolved.length > 0) process.exitCode = 1;
