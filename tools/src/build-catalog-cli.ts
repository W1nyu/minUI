import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, OUT_DIR, SITES } from "./build-catalog.js";

/**
 * `pnpm --filter tools build:catalog`
 *
 * <p>이 파일이 따로 있는 이유는 <b>부작용 때문</b>이다. 실행부가 `build-catalog.ts`의
 * 모듈 최상위에 있었을 때, `demos/src/studioRoute.ts`가 `buildMenus`를 import하는
 * 것만으로 vite가 config를 읽을 때마다 카탈로그 5개를 다시 굽고 덮어썼다.
 * dev 서버를 켜기만 해도 커밋된 파일이 바뀌었고, 검증이 걸리면 `process.exitCode = 1`이
 * 되어 <b>빌드 자체가 실패</b>했다.
 *
 * <p>그래서 `build-catalog.ts`에는 순수한 것만 남기고 <b>쓰는 일은 전부 여기</b>로 모았다.
 * 라이브러리는 import해도 아무 일이 안 일어나야 한다.
 */

mkdirSync(OUT_DIR, { recursive: true });

const results = SITES.map(build);
const allProblems = results.flatMap((r) => r.problems.map((p) => `${r.site}: ${p}`));

console.log(
  `\n  ${"사이트".padEnd(12)}${"원본".padStart(7)}${"메뉴".padStart(7)}${"갈래포함".padStart(9)}${"이름겹침".padStart(9)}` +
    `${"id겹침".padStart(8)}${"제외".padStart(7)}${"수작업".padStart(9)}${"AI뜻풀이".padStart(9)}${"high".padStart(7)}${"카드제외".padStart(9)}${"불안정id".padStart(9)}${"재연결".padStart(8)}`,
);

for (const r of results) {
  console.log(
    `  ${r.site.padEnd(12)}${String(r.stats.raw).padStart(7)}${String(r.menus.length).padStart(7)}` +
      `${String(r.stats.branches).padStart(9)}${String(r.stats.duplicateLabels).padStart(9)}${String(r.stats.deduped).padStart(8)}${String(r.stats.excluded).padStart(7)}` +
      `${String(r.stats.handSynonyms).padStart(9)}${String(r.stats.aiSynonyms).padStart(9)}${String(r.stats.highRisk).padStart(7)}` +
      `${String(r.stats.notCardable).padStart(9)}${String(r.stats.unstableIds).padStart(9)}${String(r.stats.rematched).padStart(8)}`,
  );
  writeFileSync(
    join(OUT_DIR, `${r.site}.json`),
    `${JSON.stringify(r.menus, null, 2)}\n`,
    "utf8",
  );
}

console.log(`\n  총 ${results.reduce((n, r) => n + r.menus.length, 0)}개 메뉴 → ${OUT_DIR}`);

// ── 표류 리포트 ──────────────────────────────────────────────────────────
// id가 끊어진 override를 어떻게 처리했는지 전부 드러낸다. 자동으로 붙였더라도
// 조용히 넘어가면 안 된다 — 엉뚱한 메뉴에 동의어가 붙는 것이 안 붙는 것보다 나쁘다.

const remaps = results.flatMap((r) => r.remaps.map((m) => ({ site: r.site, ...m })));
const orphans = results.flatMap((r) => r.orphans.map((o) => ({ site: r.site, ...o })));

if (remaps.length > 0) {
  console.log(`\n  id가 끊어져 다시 붙인 override ${remaps.length}건 — 확인하세요`);
  for (const m of remaps.slice(0, 20)) {
    console.log(`    ${m.site}: ${m.from}\n      → ${m.to}  (${m.how})`);
  }
}

if (orphans.length > 0) {
  console.log(`\n  붙지 못한 override ${orphans.length}건`);
  for (const o of orphans.slice(0, 20)) {
    console.log(
      `    ${o.site}: ${o.key}` +
        (o.suggestion ? `\n      가장 가까운 메뉴: ${o.suggestion} (${o.score.toFixed(2)})` : ""),
    );
  }
  console.log(
    `\n  이 항목들은 사이트가 메뉴를 없앴거나 문구를 크게 바꾼 것이다.` +
      `\n  overrides에 match: { label: "..." }를 넣으면 id와 무관하게 붙는다.`,
  );
}

if (allProblems.length > 0) {
  console.error(`\n검증 실패 — ${allProblems.length}건\n`);
  for (const p of allProblems.slice(0, 30)) console.error(`  ${p}`);
  if (allProblems.length > 30) console.error(`  … 외 ${allProblems.length - 30}건`);
  process.exitCode = 1;
} else {
  console.log("  개인정보 검증 통과\n");
}
