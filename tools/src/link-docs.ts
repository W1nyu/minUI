import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuCatalog } from "@minui/core";
import type { DocsFile } from "../../services/harvester/src/docs.js";

/**
 * 메뉴에 **근거로 쓸 문서**를 붙인다. 붙은 비율을 먼저 찍는다.
 *
 * <p>계획서 Task 2가 요구한 것이 그 숫자다 — "못 붙는 것이 대부분일 수 있다. 붙은 비율을
 * 먼저 찍는다." 붙는 비율이 낮아도 그 자체는 실패가 아니다. Task 4(근거 있는 설명)는
 * <b>붙은 것에만</b> 근거를 대면 되고, 안 붙은 메뉴는 지금처럼 이름만 보고 푼다.
 *
 * <p><b>왜 이름으로 붙이는가.</b> 하나은행은 메뉴 링크가 곧 문서 경로라 연결이 공짜라고
 * 적어 뒀지만, 그것은 <b>수집 당시의 링크</b> 이야기다. 저장된 카탈로그에는 주소가 없다
 * (`key`는 `code:57921` 같은 사이트 내부 번호다). 주소를 남기려면 카탈로그 형식을 바꿔야
 * 하고, 그러면 손 수집본과 자동 수집본이 갈린다. 이름으로 붙이는 편이 형식을 안 건드린다.
 *
 * <p><b>붙이는 기준은 문서 제목이 메뉴 이름을 품는 것뿐이다.</b> 더 느슨한 기준을 네 가지
 * 재 봤고 셋 다 못 쓴다 (2026-08-28, 문서 156개 · 메뉴 598개).
 *
 * ```
 * 제목만          9개 (1.5%)   외화예금 ← 외화예금        — 맞다
 * 제목+앞 120자   43개 (7.2%)   자동이체 ← 새소식(상세내용)  — 틀렸다
 * 제목+앞 500자   72개 (12.0%)  계좌이체 ← 서비스 안내      — 틀렸다
 * 본문 아무데나   137개 (22.9%)  계좌조회 ← 자주하는 질문     — 틀렸다
 * ```
 *
 * 새소식·이벤트를 빼고 다시 재도 마찬가지였다(제목 7 · 앞머리 35 · 앞 500자 55). 비율이
 * 오르는 만큼 <b>그 메뉴에 대한 문서가 아닌 것</b>이 섞인다. 근거는 많이 붙는 것보다
 * 틀리게 안 붙는 것이 중요하다 — 틀린 출처는 없는 출처보다 나쁘다. 출처가 붙은 문장은
 * 사용자의 의심을 지우기 때문이다.
 *
 * <p>낱말을 쪼개 겹치는 정도를 세는 방법도 쓰지 않는다. `조회`·`신청` 같은 말이 수백 개
 * 메뉴와 수십 개 문서에 다 들어 있어서, 쪼개는 순간 아무 문서나 아무 메뉴에 붙는다.
 *
 * <p>`pnpm --filter tools link:docs [-- kebhana]`
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGS = join(HERE, "../../demos/src/catalogs");
const DOCS = join(HERE, "../docs");

export interface DocLink {
  menuId: string;
  label: string;
  path?: readonly string[];
  url: string;
  docTitle: string;
}

export interface LinksFile {
  source: DocsFile["source"] & { catalog: string; linkedAt: string };
  links: DocLink[];
}

/** 이보다 짧은 이름은 붙이지 않는다. `이체`·`조회`는 아무 문서에나 있다. */
export const LABEL_MIN = 4;

const squash = (text: string) => text.replace(/[\s/·()[\]]+/g, "").toLowerCase();

/**
 * 메뉴 하나에 붙을 문서를 고른다. 없으면 `null`.
 *
 * <p>같은 제목이 여럿이면 <b>짧은 문서</b>를 고른다. 이름이 든 짧은 문서가 그 이름에 대한
 * 문서일 가능성이 높고, 긴 것은 여러 상품을 모아 둔 목록인 경우가 많다.
 */
export function pickDoc(
  label: string,
  docs: readonly { url: string; title: string; chars: number }[],
): { url: string; docTitle: string } | null {
  const needle = squash(label);
  if (needle.length < LABEL_MIN) return null;

  let best: { url: string; docTitle: string; chars: number } | null = null;
  for (const doc of docs) {
    if (!squash(doc.title).includes(needle)) continue;
    if (best === null || doc.chars < best.chars) {
      best = { url: doc.url, docTitle: doc.title, chars: doc.chars };
    }
  }

  if (best === null) return null;
  return { url: best.url, docTitle: best.docTitle };
}

const site = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "kebhana";

const docsFile = JSON.parse(readFileSync(join(DOCS, `${site}.docs.json`), "utf8")) as DocsFile;
const catalog = JSON.parse(
  readFileSync(join(CATALOGS, `${site}.json`), "utf8"),
) as MenuCatalog;

const links: DocLink[] = [];

for (const menu of catalog) {
  const found = pickDoc(menu.label, docsFile.docs);
  if (found === null) continue;
  links.push({
    menuId: menu.id,
    label: menu.label,
    ...(menu.path ? { path: menu.path } : {}),
    url: found.url,
    docTitle: found.docTitle,
  });
}

const out = join(DOCS, `${site}.links.json`);
writeFileSync(
  out,
  `${JSON.stringify(
    {
      source: {
        ...docsFile.source,
        catalog: `${site}.json`,
        linkedAt: new Date().toISOString(),
      },
      links,
    } satisfies LinksFile,
    null,
    2,
  )}\n`,
  "utf8",
);

const percent = (n: number) => ((n / catalog.length) * 100).toFixed(1);

console.log(
  [
    "",
    `  ${site} — 메뉴 ${catalog.length}개 · 문서 ${docsFile.docs.length}개`,
    `  붙음   ${links.length}개 (${percent(links.length)}%) → ${out}`,
    "",
  ].join("\n"),
);

// 붙은 것을 전부 눈으로 본다. 비율만 보면 엉뚱하게 붙은 것을 못 잡는다 —
// 실제로 느슨한 기준을 쓸 때 그렇게 걸렸다.
for (const link of links) {
  console.log(`    ${link.label.padEnd(16)} ← ${link.docTitle}`);
}
console.log("");
