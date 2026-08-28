import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuCatalog } from "@minui/core";
import { explain } from "../../services/enricher/src/explain.js";
import { Gemini, readApiKey } from "../../services/enricher/src/gemini.js";
import { explainWithSource } from "../../services/enricher/src/grounded.js";
import type { DocsFile } from "../../services/harvester/src/docs.js";
import { SITES } from "./build-catalog.js";
import type { LinksFile } from "./link-docs.js";

/**
 * "이게 무슨 뜻이에요?"의 답을 **미리 구워 둔다.**
 *
 * <p>배포는 GitHub Pages다 — 정적 호스팅이라 `/api/explain` 중계를 올릴 수 없다.
 * 그런데 뜻풀이는 <b>`label` + `path`만 있으면 답이 정해지는 순수 조회</b>다. 런타임에
 * 물을 이유가 없고, 빌드 타임에 한 번 물어 두면 배포에 API 키가 아예 안 들어간다
 * (절대 보호선 규칙 7이 구조로 지켜진다).
 *
 * <p><b>이것이 뜻풀이를 색인에 넣는 것과 다른 점.</b> 2026-08-24에 `hint`를 벡터 문서에
 * 넣었다가 되돌렸다 — blind 질의는 +31.7%p 올랐는데 사람이 쓴 질의는 −6.7%p 떨어졌다.
 * 모델이 쓴 글을 <b>검색이 읽으면</b> 그것에서 파생된 지표만 오른다. 여기서는 검색이
 * 아니라 <b>사람이</b> 읽는다. `MenuIndex`는 지금도 `label`과 `synonyms`만 term으로
 * 넣으므로 이 캐시는 검색 점수에 닿지 않는다.
 *
 * <p>키는 `label|path`다. `menuId`가 아닌 이유는 사이트가 개편되어 id가 바뀌어도
 * 같은 이름의 메뉴면 답이 그대로 맞기 때문이다 — `makeExplain`이 서버로 보내던 것과
 * 같은 키를 쓴다.
 *
 * <p>`pnpm --filter tools build:explain-cache [-- --limit 20]`
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGS = join(HERE, "../../demos/src/catalogs");
const FRONTEND_CATALOG = join(HERE, "../../frontend/src/catalog.ts");
const OUT = join(HERE, "../../shared/host-ai/explain-cache.json");
const SOURCES_OUT = join(HERE, "../../shared/host-ai/explain-sources.json");
const DOCS = join(HERE, "../docs");
const KEY_FILE = join(HERE, "../../api.txt");

const MODEL = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";

/** 캐시 키. `shared/host-ai/explain.ts`의 `explainKey`와 **같은 규칙이어야 한다.** */
function key(label: string, path?: readonly string[]): string {
  return path && path.length > 0 ? `${label}|${path.join(">")}` : label;
}

interface Target {
  label: string;
  path?: readonly string[];
  where: string;
}

/** 뜻풀이가 없어 물어봐야 하는 메뉴를 전부 모은다. */
function collect(): Target[] {
  const targets: Target[] = [];
  const seen = new Set<string>();

  const add = (label: string, path: readonly string[] | undefined, where: string) => {
    const k = key(label, path);
    if (seen.has(k)) return;
    seen.add(k);
    targets.push({ label, ...(path ? { path } : {}), where });
  };

  for (const site of SITES) {
    const catalog = JSON.parse(
      readFileSync(join(CATALOGS, `${site}.json`), "utf8"),
    ) as MenuCatalog;
    for (const menu of catalog) {
      if (menu.hint) continue;
      add(menu.label, menu.path, site);
    }
  }

  /*
   * 미니은행은 카탈로그가 TS 소스라 JSON처럼 못 읽는다. 25개뿐이고 형태가 고정이라
   * 정규식으로 label과 hint 유무만 본다 — 파서를 들이는 것이 과하다.
   *
   * 여기서 걸리는 것은 §12가 "이름을 모르는 것"으로 지목한 메뉴들이다. `catalog.ts`가
   * 그 여섯을 **일부러** 비워 두었고, 비워 둔 이유도 그 파일 주석에 있다.
   */
  const source = readFileSync(FRONTEND_CATALOG, "utf8");
  for (const block of source.split(/\n  \{/).slice(1)) {
    const label = /label:\s*"([^"]+)"/.exec(block)?.[1];
    if (!label || /\n\s*hint:/.test(block)) continue;
    const path = /path:\s*\[([^\]]*)\]/
      .exec(block)?.[1]
      ?.match(/"([^"]+)"/g)
      ?.map((s) => s.slice(1, -1));
    add(label, path, "미니은행");
  }

  return targets;
}

/** 근거 있는 뜻풀이 하나. `shared/host-ai/explain.ts`의 `GroundedHint`와 같은 모양이다. */
interface GroundedRecord {
  hint: string;
  quote: string;
  url: string;
  title: string;
}

/**
 * 문서가 붙은 메뉴를 모은다 (`tools/src/link-docs.ts`가 붙여 둔 것).
 *
 * <p><b>뜻풀이가 이미 있어도 모은다.</b> 카탈로그의 뜻풀이는 이름만 보고 쓴 것이고,
 * 여기서 만드는 것은 그 금융사의 공개 안내문을 읽고 쓴 뒤 인용까지 대조를 통과한 것이다.
 * 같은 자리에 놓고 고르면 뒤쪽이 이긴다.
 */
function collectGrounded(): { key: string; label: string; path?: readonly string[]; document: { url: string; title: string; text: string } }[] {
  const found: { key: string; label: string; path?: readonly string[]; document: { url: string; title: string; text: string } }[] = [];

  for (const site of SITES) {
    const linksPath = join(DOCS, `${site}.links.json`);
    const docsPath = join(DOCS, `${site}.docs.json`);
    if (!existsSync(linksPath) || !existsSync(docsPath)) continue;

    const links = JSON.parse(readFileSync(linksPath, "utf8")) as LinksFile;
    const docs = JSON.parse(readFileSync(docsPath, "utf8")) as DocsFile;
    const byUrl = new Map(docs.docs.map((doc) => [doc.url, doc]));

    for (const link of links.links) {
      const doc = byUrl.get(link.url);
      // 문서 파일만 다시 굽고 연결은 안 굽는 경우가 있다. 없는 문서를 근거로 삼지 않는다.
      if (doc === undefined) continue;
      found.push({
        key: key(link.label, link.path),
        label: link.label,
        ...(link.path ? { path: link.path } : {}),
        document: { url: doc.url, title: doc.title, text: doc.text },
      });
    }
  }
  return found;
}

const args = process.argv.slice(2);
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : undefined;

const all = collect();
const targets = limit && Number.isFinite(limit) ? all.slice(0, limit) : all;

// 이미 해 둔 것은 건너뛴다 — 무료 한도로 도는 이상 이어하기가 기본 동작이어야 한다
// (`services/enricher/src/enrich.ts`가 같은 이유로 같은 구조를 쓴다).
const existing: Record<string, string> = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, "utf8")) as Record<string, string>)
  : {};

const existingSources: Record<string, GroundedRecord> = existsSync(SOURCES_OUT)
  ? (JSON.parse(readFileSync(SOURCES_OUT, "utf8")) as Record<string, GroundedRecord>)
  : {};

const todo = targets.filter((t) => existing[key(t.label, t.path)] === undefined);
const groundedTodo = collectGrounded().filter((t) => existingSources[t.key] === undefined);

console.log(
  `\n  뜻풀이 없는 메뉴 ${all.length}개` +
    (targets.length !== all.length ? ` (이번엔 ${targets.length}개)` : "") +
    ` · 이미 된 것 ${targets.length - todo.length}개 · 물어볼 것 ${todo.length}개`,
);
console.log(`  문서가 붙은 메뉴 중 근거를 아직 안 받은 것 ${groundedTodo.length}개`);
console.log(`  모델 ${MODEL}\n`);

if (todo.length === 0 && groundedTodo.length === 0) {
  console.log("  할 일이 없습니다.\n");
  process.exit(0);
}

const gemini = new Gemini(readApiKey(KEY_FILE), {
  model: MODEL,
  onNote: (message) => console.log(`    ${message}`),
});

const result: Record<string, string> = { ...existing };
let answered = 0;
let refused = 0;

// 중간에 죽어도 한 것은 남게 매번 쓴다. 426개를 처음부터 다시 묻는 것이 가장 아깝다.
const save = () => {
  mkdirSync(dirname(OUT), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
};

const groundedResult: Record<string, GroundedRecord> = { ...existingSources };
let grounded = 0;
let unsupported = 0;

const saveGrounded = () => {
  mkdirSync(dirname(SOURCES_OUT), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(groundedResult).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(SOURCES_OUT, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
};

/*
 * 근거 있는 뜻풀이. **인용이 문서에 없으면 그 답은 통째로 버린다** —
 * `services/enricher/src/cite.ts`가 문자열로 대조하고, 못 지나면 여기 `null`이 온다.
 * 버린 것은 기록하지 않는다. 다음에 다시 물으면 통과할 수 있고, 통과 못 한 답을
 * "모른다"로 굳혀 두면 문서가 좋아져도 영영 안 묻는다.
 */
for (const [index, target] of groundedTodo.entries()) {
  try {
    const answer = await explainWithSource(
      gemini,
      { label: target.label, ...(target.path ? { path: target.path } : {}) },
      target.document,
    );
    if (answer === null) {
      unsupported += 1;
      console.log(`    ${target.label} — 근거를 못 댔다 (버림)`);
    } else {
      groundedResult[target.key] = {
        hint: answer.hint,
        quote: answer.source.quote,
        url: answer.source.url,
        title: answer.source.title,
      };
      grounded += 1;
      console.log(`    ${target.label} — ${answer.hint}`);
      console.log(`      “${answer.source.quote}”`);
    }
  } catch (error) {
    console.log(`    ${target.label} — 실패: ${String(error).slice(0, 80)}`);
  }

  if ((index + 1) % 5 === 0 || index === groundedTodo.length - 1) saveGrounded();
}

if (groundedTodo.length > 0) {
  saveGrounded();
  console.log(`\n  근거 있는 뜻풀이 ${grounded}개 · 근거 못 댄 것 ${unsupported}개 → ${SOURCES_OUT}\n`);
}

for (const [index, target] of todo.entries()) {
  const k = key(target.label, target.path);
  let hint: string | null = null;
  try {
    hint = await explain(gemini, {
      label: target.label,
      ...(target.path ? { path: target.path } : {}),
    });
  } catch (error) {
    // 한 건이 죽는다고 426건을 버리지 않는다. 다음에 다시 돌리면 이어서 묻는다.
    console.log(`    ${target.label} — 실패: ${String(error).slice(0, 80)}`);
    continue;
  }

  if (hint === null) {
    // 모델이 모른다고 한 것도 기록한다. 안 그러면 돌릴 때마다 같은 것을 또 묻는다.
    // 빈 문자열은 화면에서 `null`과 같게 다뤄진다 — "물어봤는데 모른다".
    result[k] = "";
    refused += 1;
  } else {
    result[k] = hint;
    answered += 1;
  }

  if ((index + 1) % 20 === 0 || index === todo.length - 1) {
    save();
    console.log(`  ${index + 1}/${todo.length}  (풀이 ${answered} · 모름 ${refused})`);
  }
}

save();

const { usage } = gemini;
console.log(
  `\n  풀이 ${answered}개 · 모름 ${refused}개 → ${OUT}` +
    `\n  요청 ${usage.requests}회 · 재시도 ${usage.retries}회` +
    `\n  토큰 입력 ${usage.inputTokens.toLocaleString()} · 출력 ${usage.outputTokens.toLocaleString()}\n`,
);
