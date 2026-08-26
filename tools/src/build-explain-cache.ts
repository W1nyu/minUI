import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuCatalog } from "@minui/core";
import { explain } from "../../services/enricher/src/explain.js";
import { Gemini, readApiKey } from "../../services/enricher/src/gemini.js";
import { SITES } from "./build-catalog.js";

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

const todo = targets.filter((t) => existing[key(t.label, t.path)] === undefined);

console.log(
  `\n  뜻풀이 없는 메뉴 ${all.length}개` +
    (targets.length !== all.length ? ` (이번엔 ${targets.length}개)` : "") +
    ` · 이미 된 것 ${targets.length - todo.length}개 · 물어볼 것 ${todo.length}개`,
);
console.log(`  모델 ${MODEL}\n`);

if (todo.length === 0) {
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
