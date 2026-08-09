import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MenuIndex, NgramTfIdfProvider } from "@minui/core";
import { CATALOG } from "../../frontend/src/catalog.js";

/**
 * 검색 색인을 빌드 타임 산출물로 굽는다 (기획안 §8.3).
 *
 * 런타임에는 질의 하나만 인코딩하면 되고, 네트워크 호출이 전혀 없다.
 * 색인이 JSON인 덕에 다른 언어로 포팅해도 같은 파일을 읽어 쓸 수 있다.
 *
 * 지금은 카탈로그가 25개뿐이라 런타임에 만들어도 순식간이지만(엔진 기본 동작이 그렇다),
 * 증권 앱처럼 메뉴가 수백 개가 되면 이 산출물이 필요해진다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "../out");
const OUT_FILE = join(OUT_DIR, "search-index.json");

const index = new MenuIndex(CATALOG);
const provider = NgramTfIdfProvider.build(index.documents());
const serialized = provider.toJSON();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(serialized)}\n`, "utf8");

const bytes = Buffer.byteLength(JSON.stringify(serialized), "utf8");
const grams = Object.keys(serialized.idf).length;

console.log(`검색 색인을 만들었습니다`);
console.log(`  메뉴      ${CATALOG.length}개`);
console.log(`  n-gram    ${grams}개`);
console.log(`  크기      ${(bytes / 1024).toFixed(1)} KB`);
console.log(`  경로      ${OUT_FILE}`);
console.log(
  `\n비교: 다국어 문장 임베딩 모델은 최소 100MB대다. 기획안 §14가 번들 크기를` +
    `\n리스크로 꼽은 이유이며, 이 수치가 그 판단의 근거가 된다.`,
);
