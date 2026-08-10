import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MenuIndex, NgramTfIdfProvider, type MenuCatalog } from "@minui/core";

/**
 * 이식 규모 실측 (기획안 §14 번들 크기 리스크 / §15 증권 앱 적용).
 *
 * 미니은행 25개에서 잰 수치가 수백~천 개에서도 성립하는지 확인한다.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = ["kbstar", "kbsec", "miraeasset", "shinhan"] as const;

console.log(
  `\n  ${"사이트".padEnd(12)}${"메뉴".padStart(7)}${"카테고리".padStart(9)}` +
    `${"n-gram".padStart(9)}${"색인".padStart(10)}${"메뉴당".padStart(9)}${"질의(ms)".padStart(10)}`,
);

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;

  const index = new MenuIndex(catalog);
  const provider = NgramTfIdfProvider.build(index.documents());
  const json = JSON.stringify(provider.toJSON());
  const bytes = Buffer.byteLength(json, "utf8");

  const started = performance.now();
  for (let i = 0; i < 100; i++) provider.similarity("자동이체 안 나가게 해야 하는데");
  const perQuery = (performance.now() - started) / 100;

  console.log(
    `  ${site.padEnd(12)}${String(catalog.length).padStart(7)}` +
      `${String(index.categories().length).padStart(9)}` +
      `${String(Object.keys(provider.toJSON().idf).length).padStart(9)}` +
      `${`${(bytes / 1024).toFixed(0)}KB`.padStart(10)}` +
      `${`${(bytes / catalog.length).toFixed(0)}B`.padStart(9)}` +
      `${perQuery.toFixed(2).padStart(10)}`,
  );
}

console.log(`\n  비교: 미니은행 25개 = 29.6KB · 다국어 문장 임베딩 모델 = 100MB대\n`);
