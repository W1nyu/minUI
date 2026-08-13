import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

/**
 * 빌드된 스니펫이 **실제 페이지에서** 서버 수집과 같은 것을 내놓는가.
 *
 * <p>스니펫과 서버 수집은 같은 파일(`extract.ts`·`keys.ts`)을 쓰지만, 스니펫은 esbuild로
 * 묶여 IIFE가 된다. 묶는 과정에서 깨지면 사용자는 콘솔에 붙여넣고 나서야 안다.
 *
 * <p>검사 대상은 **내려받은 파일**이다. 처음에는 `window`에 결과를 얹어 두고 읽었는데,
 * 페이지가 도중에 다시 뜨면서 그 값이 사라졌다 — 스니펫은 786개를 제대로 모으고 콘솔에
 * 찍기까지 했는데도 검사는 "결과 없음"이었다. 곁길로 확인하면 그런 일이 난다.
 * 사용자가 실제로 손에 넣는 것은 파일이므로, 파일을 본다.
 *
 * <p>`pnpm --filter @minui/harvester verify:snippet -- <URL> [기대개수]`
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, "../out/harvest-snippet.js");

const [url, expected] = process.argv.slice(2);
if (!url) {
  console.error("쓰는 법: verify:snippet -- <URL> [기대개수]");
  process.exit(1);
}

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }));

const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: "ko-KR",
  acceptDownloads: true,
});

page.on("console", (msg) => console.log(`  [콘솔] ${msg.text()}`));
page.on("pageerror", (error) => console.log(`  [오류] ${error.message}`));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

/*
 * `addScriptTag`가 아니라 `evaluate`로 넣는다.
 *
 * 은행 사이트는 CSP가 빡빡해서 주입한 <script> 태그가 막힌다(하나은행에서 실제로 막혔다).
 * 그런데 **콘솔에 붙여넣는 것은 CSP를 받지 않는다** — 그것이 이 스니펫의 실제 사용법이고,
 * `evaluate`가 그것과 같은 통로(CDP Runtime.evaluate)를 쓴다. 이쪽이 오히려 실제와 같은 조건이다.
 */
const downloaded = page.waitForEvent("download", { timeout: 40_000 });
await page.evaluate(readFileSync(BUNDLE, "utf8"));

const download = await downloaded;
const path = await download.path();
const text = readFileSync(path, "utf8");
const result = JSON.parse(text) as {
  source: { site: string; host: string; note: string };
  items: { path: string[]; label: string; key: string }[];
};

await browser.close();

const depths = new Map<number, number>();
for (const item of result.items) {
  depths.set(item.path.length, (depths.get(item.path.length) ?? 0) + 1);
}

console.log(
  [
    "",
    `  내려받은 파일  ${download.suggestedFilename()}`,
    `  메뉴 ${result.items.length}개 · ${result.source.site} (${result.source.host})`,
    `  깊이별 ${[...depths.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, count]) => `${depth}단 ${count}`)
      .join(" · ")}`,
    "",
  ].join("\n"),
);

if (expected) {
  const target = Number(expected);
  const gap = Math.abs(result.items.length - target) / target;
  console.log(
    gap <= 0.05
      ? `  서버 수집(${target}개)과 5% 안쪽으로 일치한다. 묶인 스니펫이 온전하다.\n`
      : `  서버 수집(${target}개)과 ${(gap * 100).toFixed(0)}% 차이난다. 확인이 필요하다.\n`,
  );
  if (gap > 0.05) process.exit(1);
}
