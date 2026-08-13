import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { enrich } from "./enrich.js";
import { readApiKey } from "./gemini.js";

/**
 * `pnpm --filter @minui/enricher enrich -- <사이트> [--limit N] [--batch N]`
 *
 * <p>무료 한도로 도는 것을 전제로 한다. 처음에는 `--limit 40`으로 한 묶음만 돌려
 * 결과를 눈으로 보고, 괜찮으면 전체를 돌리는 순서가 좋다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = join(HERE, "../../../api.txt");

const MODEL = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";

const args = process.argv.slice(2);
const site = args.find((arg) => !arg.startsWith("--"));

if (!site) {
  console.error(
    "\n  쓰는 법: pnpm --filter @minui/enricher enrich -- <사이트> [--limit N] [--batch N]\n" +
      "  사이트: kbstar · kbsec · miraeasset · shinhan · kebhana\n",
  );
  process.exit(1);
}

const numberArg = (name: string): number | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
};

const limit = numberArg("limit");
const batchSize = numberArg("batch");

console.log(`\n  ${site} · ${MODEL}${limit ? ` · 앞의 ${limit}개만` : ""}\n`);

const result = await enrich({
  site,
  model: MODEL,
  apiKey: readApiKey(KEY_FILE),
  ...(limit !== undefined ? { limit } : {}),
  ...(batchSize !== undefined ? { batchSize } : {}),
  onProgress: (message) => console.log(`  ${message}`),
});

const { usage } = result;

/*
 * 토큰을 실제로 세어 남긴다.
 *
 * 앞서 비용을 추정했는데, 이 프로젝트는 추정을 사실처럼 적지 않는 것으로 일관해 왔다.
 * 응답이 실제 사용량을 주므로 그대로 쓴다.
 */
console.log(
  [
    "",
    `  보강 ${result.enriched}/${result.total}개 · 버린 응답 ${result.rejected}건`,
    `  → ${result.outPath}`,
    "",
    `  요청 ${usage.requests}건 (재시도 ${usage.retries})`,
    `  입력 ${usage.inputTokens.toLocaleString()} 토큰 · 출력 ${usage.outputTokens.toLocaleString()} 토큰`,
    `  메뉴당 평균 ${
      result.total > 0
        ? Math.round((usage.inputTokens + usage.outputTokens) / result.total)
        : 0
    } 토큰`,
    "",
  ].join("\n"),
);
