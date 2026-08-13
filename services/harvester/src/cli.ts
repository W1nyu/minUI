import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { harvest, siteNameFrom } from "./harvest.js";

/**
 * `pnpm --filter @minui/harvester harvest -- <URL> [이름]`
 *
 * <p>산출물은 `tools/catalogs/<이름>.raw.json`이다. 손으로 수집하던 파일과 같은 자리에
 * 같은 형식으로 떨어져야, 그 다음 단계(`build:catalog`)가 아무것도 모른 채 그대로 돈다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGS = join(HERE, "../../../tools/catalogs");

const [url, name] = process.argv.slice(2);

if (!url) {
  console.error("\n  쓰는 법: pnpm --filter @minui/harvester harvest -- <URL> [이름]\n");
  process.exit(1);
}

const site = name ?? siteNameFrom(new URL(/^https?:/i.test(url) ? url : `https://${url}`).host);

const result = await harvest({
  url,
  site,
  onProgress: (stage, detail) => console.log(`  ${stage.padEnd(9)} ${detail ?? ""}`),
});

mkdirSync(CATALOGS, { recursive: true });
const out = join(CATALOGS, `${site}.raw.json`);
writeFileSync(
  out,
  `${JSON.stringify({ source: result.source, items: result.items }, null, 2)}\n`,
  "utf8",
);

const { diagnostics: d } = result;
console.log(
  [
    "",
    `  메뉴 ${result.items.length}개 → ${out}`,
    `  전략   ${d.strategy}${d.frame ? `  프레임 ${d.frame}` : ""}`,
    `  트리거 ${d.trigger || "(못 찾음 — 이미 펼쳐져 있었을 수 있다)"}`,
    `  버림   외부 ${d.dropped.external} · 빈 라벨 ${d.dropped.empty} · 중복 ${d.dropped.duplicate}`,
    `  걸린 시간 ${(d.elapsedMs / 1000).toFixed(1)}초`,
    "",
  ].join("\n"),
);

// 계층 분포. 1단만 나오면 하위 메뉴를 못 읽은 것이다 — 회수율보다 먼저 보이는 신호다.
const byDepth = new Map<number, number>();
for (const item of result.items) {
  byDepth.set(item.path.length, (byDepth.get(item.path.length) ?? 0) + 1);
}
console.log(
  `  깊이별  ${[...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, count]) => `${depth}단 ${count}`)
    .join(" · ")}\n`,
);
