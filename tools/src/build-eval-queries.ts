import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuCatalog } from "@minui/core";
import { Gemini, readApiKey } from "../../services/enricher/src/gemini.js";
import { makeEnvelope, pickEvenly, dropNearDuplicates } from "./eval-prompts.js";
import {
  QUERY_SCHEMA,
  QUERY_SYSTEM,
  buildQueryPrompt,
  keepClean,
  type QueryEnvelope,
} from "./eval-queries.js";

/**
 * 깨끗한 평가 세트를 만든다 — 모델이 봉투만 보고 질의를 쓴다 (M11 Task 13).
 *
 * <p>`report:contamination`이 깨끗한 질의가 75건 중 1건뿐이라고 답했다. 그 크기로는
 * 신경망이 이겼는지 말할 수 없고, 제3자 질의는 사람을 모아야 한다. 그 사이를 메운다.
 *
 * <p><b>모델은 정답을 못 본다.</b> 프롬프트에 들어가는 것은 뜻풀이와 갈래뿐이고
 * (`buildQueryPrompt`가 고정한다), 받은 뒤에도 같은 오염 필터로 한 번 더 거른다.
 *
 * <p>산출물의 `source`는 `blind-paraphrase`다. 제3자 질의(`thirdparty`)와
 * <b>합계를 내지 않는다</b> — 오염 정도가 다른 것을 한 수치로 합치면 그 수치가
 * 무엇을 말하는지 알 수 없게 된다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;
const MODEL = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";

const perSite = Number(process.argv[2] ?? 24);
const perMenu = Number(process.argv[3] ?? 5);

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// ── 봉투를 뽑는다 (문항지와 같은 규칙) ──────────────────────────────────

const envelopes: (QueryEnvelope & { site: string })[] = [];

for (const site of SITES) {
  const catalog = readJson<MenuCatalog>(join(HERE, `../../demos/src/catalogs/${site}.json`), []);
  const ai = readJson<Record<string, { hint?: string }>>(
    join(HERE, `../catalogs/${site}.ai.json`),
    {},
  );
  const overrides = readJson<Record<string, { synonyms?: string[] }>>(
    join(HERE, `../catalogs/${site}.overrides.json`),
    {},
  );

  const parents = new Set<string>();
  for (const menu of catalog) for (const segment of menu.path ?? []) parents.add(segment);

  const usable: (QueryEnvelope & { site: string })[] = [];
  for (const menu of catalog) {
    if (parents.has(menu.label)) continue;

    const synonyms = overrides[menu.id]?.synonyms ?? [];
    const envelope = makeEnvelope({
      menuId: menu.id,
      label: menu.label,
      terms: synonyms,
      hint: ai[menu.id]?.hint,
      path: menu.path ?? [],
    });
    if (!envelope.usable || !envelope.description) continue;

    usable.push({
      site,
      menuId: menu.id,
      expect: menu.label,
      synonyms,
      shown: envelope.description,
      context: envelope.context ?? [],
    });
  }

  const wide = pickEvenly(usable, perSite * 2);
  const kept = dropNearDuplicates(wide.map((item) => item.shown));
  envelopes.push(...kept.map((index) => wide[index]!).slice(0, perSite));
}

// ── 모델에게 묻는다 ────────────────────────────────────────────────────

console.log(`
  깨끗한 평가 세트 만들기 — 모델이 봉투만 보고 쓴다
  ${"─".repeat(66)}

  모델      ${MODEL}
  봉투      ${envelopes.length}개 (사이트당 ${perSite})
  요청      봉투마다 ${perMenu}가지

  **모델은 라벨도 동의어도 못 본다.** 받은 뒤 오염 필터로 한 번 더 거른다.
`);

const gemini = new Gemini(readApiKey(join(HERE, "../../api.txt")), { model: MODEL });

interface Case {
  query: string;
  expect: string;
  menuId: string;
  site: string;
  source: "blind-paraphrase";
  shown: string;
}

const cases: Case[] = [];
let asked = 0;
let received = 0;
let dropped = 0;
let failed = 0;

for (const envelope of envelopes) {
  asked += 1;
  try {
    const answer = (await gemini.json(
      QUERY_SYSTEM,
      buildQueryPrompt(envelope, perMenu),
      QUERY_SCHEMA,
    )) as { queries?: unknown };

    const raw = Array.isArray(answer.queries)
      ? answer.queries.filter((q): q is string => typeof q === "string")
      : [];
    received += raw.length;

    /*
     * 정답으로 인정될 표현 전부와 비교해서 거른다 — 라벨과 동의어를 함께 본다.
     * 파이프라인이 보는 것과 같은 글자여야 측정이 실제를 말한다.
     */
    const clean = keepClean(raw, [envelope.expect, ...envelope.synonyms]);
    dropped += raw.length - clean.length;

    for (const query of clean) {
      cases.push({
        query,
        expect: envelope.expect,
        menuId: envelope.menuId,
        site: envelope.site,
        source: "blind-paraphrase",
        shown: envelope.shown,
      });
    }
  } catch (error) {
    failed += 1;
    console.error(`  [실패] ${envelope.shown} — ${error instanceof Error ? error.message : error}`);
  }

  if (asked % 20 === 0) {
    console.log(`  ${asked}/${envelopes.length} 봉투 · 질의 ${cases.length}건`);
  }
}

// ── 픽스처로 굳힌다 ────────────────────────────────────────────────────

const fixture = {
  description:
    "깨끗한 평가 세트 (M11). 모델이 뜻풀이와 갈래만 보고 쓴 질의다 — 라벨도 동의어도 " +
    "보여 주지 않았고(`buildQueryPrompt`), 받은 뒤 오염 필터로 한 번 더 걸렀다. " +
    "**남는 흠은 다른 종류다: 모델은 73세처럼 말하지 않는다.** 문법이 반듯하고 머뭇거림도 " +
    "사투리도 없다. 그래서 이 세트로 주장할 수 있는 것은 '글자가 안 겹치는 바꿔 쓴 말에서 " +
    "이겼다'까지다. 사람 말은 `source: thirdparty`와 M10 참가자 발화가 답한다. " +
    "출처가 다른 것끼리 **합계를 내지 않는다**.",
  protocol: "docs/평가세트-프로토콜.md",
  model: MODEL,
  cases,
};

mkdirSync(join(HERE, "../fixtures"), { recursive: true });
writeFileSync(
  join(HERE, "../fixtures/neural-queries.json"),
  JSON.stringify(fixture, null, 2),
  "utf8",
);

const bySite = new Map<string, number>();
for (const item of cases) bySite.set(item.site, (bySite.get(item.site) ?? 0) + 1);

console.log(`
  ${"─".repeat(66)}
  봉투 ${asked}개 · 받은 질의 ${received}건 · **오염으로 버림 ${dropped}건** · 실패 ${failed}건

  남은 질의 ${cases.length}건`);
for (const site of SITES) {
  console.log(`     ${site.padEnd(13)} ${String(bySite.get(site) ?? 0).padStart(4)}건`);
}
console.log(`
  자리   tools/fixtures/neural-queries.json  (저장소에 들어간다 — 정답이 안 새므로)

  다음: pnpm --filter tools report:contamination 으로 전부 clean인지 확인하고,
        bench:neural로 사전 등록 게이트에 건다.
`);
