import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { harvestDocs } from "./docs.js";

/**
 * `pnpm --filter @minui/harvester docs -- <URL> [이름] [--pages 300] [--depth 2]`
 *
 * <p>산출물은 `tools/docs/<이름>.docs.json`이다. 카탈로그(`tools/catalogs`)와 나란히 두되
 * 폴더를 가른 것은 성격이 달라서다 — 카탈로그는 <b>이름</b>이고 배포에 들어가지만,
 * 문서는 <b>본문</b>이고 뜻풀이를 구울 때만 쓰인다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "../../../tools/docs");

const argv = process.argv.slice(2);
const flag = (name: string): number | undefined => {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const value = Number(argv[at + 1]);
  return Number.isFinite(value) ? value : undefined;
};

const positional = argv.filter((arg, index) => {
  if (arg.startsWith("--")) return false;
  const previous = argv[index - 1];
  return !(previous !== undefined && previous.startsWith("--"));
});

const [url, name] = positional;

if (!url) {
  console.error(
    "\n  쓰는 법: pnpm --filter @minui/harvester docs -- <URL> [이름] [--pages 300] [--depth 2]\n",
  );
  process.exit(1);
}

const result = await harvestDocs({
  url,
  ...(name !== undefined ? { site: name } : {}),
  ...(flag("pages") !== undefined ? { maxPages: flag("pages") as number } : {}),
  ...(flag("depth") !== undefined ? { maxDepth: flag("depth") as number } : {}),
  ...(flag("min") !== undefined ? { minChars: flag("min") as number } : {}),
  onProgress: (stage, detail) => console.log(`  ${stage.padEnd(7)} ${detail ?? ""}`),
});

mkdirSync(DOCS, { recursive: true });
const out = join(DOCS, `${result.source.site}.docs.json`);
writeFileSync(
  out,
  `${JSON.stringify({ source: result.source, docs: result.docs }, null, 2)}\n`,
  "utf8",
);

const { diagnostics: d } = result;
const lengths = result.docs.map((doc) => doc.chars).sort((a, b) => a - b);
const median = lengths.length > 0 ? (lengths[Math.floor(lengths.length / 2)] ?? 0) : 0;

console.log(
  [
    "",
    `  문서 ${result.docs.length}개 → ${out}`,
    `  본문   중앙값 ${median.toLocaleString()}자 · 최대 ${(lengths[lengths.length - 1] ?? 0).toLocaleString()}자`,
    `  요청   ${d.fetched}쪽 (후보 ${d.seen}개)`,
    `  안 부름 robots ${d.skipped.robots} · 외부 ${d.skipped.offSite} · jsp 아님 ${d.skipped.notJsp}`,
    `  버림   너무 짧음 ${d.dropped.tooShort} · 실패 ${d.dropped.failed} · 중복 ${d.dropped.duplicate}`,
    `  걸린 시간 ${(d.elapsedMs / 1000).toFixed(1)}초`,
    "",
  ].join("\n"),
);
