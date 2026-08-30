import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  resolveConfig,
  type MenuCatalog,
} from "@minui/core";
import { assist, type AssistCandidate } from "./assist.js";
import {
  OpenAiCompatible,
  readOpenAiCompatibleConfig,
} from "./openaiCompatible.js";
import { Gemini, readApiKey } from "./gemini.js";
import type { LlmClient } from "./llm.js";

/**
 * 런타임 LLM 폴백이 실제로 이득인가.
 *
 * <p>온디바이스가 <b>못 찾았을 때만</b> 부르므로, 재야 할 것은 두 가지다.
 * <ul>
 *   <li><b>얻는 것</b> — 되묻던 질의를 몇 개나 풀어 주는가
 *   <li><b>잃는 것</b> — 답이 없어야 할 질의에 억지로 메뉴를 들이미는가
 * </ul>
 *
 * <p>앞엣것만 재면 폴백은 언제나 좋아 보인다. 답 없는 질의 20건을 함께 돌리는 이유다.
 *
 * <p>`pnpm --filter @minui/enricher bench:assist`
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = join(HERE, "../../../api.txt");
const MODEL = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";

const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;
/** 후보를 몇 개나 보여 줄 것인가. 많으면 정확하지만 토큰이 는다. */
const CANDIDATE_COUNT = 20;

interface Case {
  query: string;
  expect: string;
}

const querySet = JSON.parse(
  readFileSync(join(HERE, "../../../tools/fixtures/site-queries.json"), "utf8"),
) as { sites: Record<string, Case[]>; negative: string[] };

/**
 * 어느 공급자로 잴 것인가 (AI-10). `MINUI_LLM=compat`로 두 번째 공급자를 잰다.
 *
 * <p>**같은 프롬프트에 모델만 바꾼다.** 후보 목록도 질의 세트도 판정 규칙도 그대로다.
 * 기획안 §16의 "LLM 비교 실험이 성립하지 않는다"는 <b>사람 동의어 대 LLM 동의어</b>
 * 비교였고 — 질의를 쓴 사람이 답도 썼기 때문에 성립하지 않았다 — 이것은 그 함정에
 * 걸리지 않는다. 양쪽이 같은 세트를 같은 조건에서 본다.
 *
 * <p>여기서 `FallbackLlm`을 쓰지 않는 것이 요점이다. 재는 동안 공급자가 조용히 바뀌면
 * 무엇을 쟀는지 알 수 없다. <b>측정은 한 번에 하나만 본다.</b>
 */
const PROVIDER = process.env["MINUI_LLM"] ?? "gemini";

const llm: LlmClient = (() => {
  if (PROVIDER === "compat") {
    const compat = readOpenAiCompatibleConfig();
    if (!compat) {
      throw new Error(
        "OPENAI_COMPAT_BASE_URL · OPENAI_COMPAT_API_KEY · OPENAI_COMPAT_MODEL 셋이 다 있어야 합니다.",
      );
    }
    return new OpenAiCompatible(compat.apiKey, {
      baseUrl: compat.baseUrl,
      model: compat.model,
      onNote: (message) => console.log(`    ${message}`),
    });
  }
  return new Gemini(readApiKey(KEY_FILE), {
    model: MODEL,
    onNote: (message) => console.log(`    ${message}`),
  });
})();

/** 토큰 집계는 Gemini만 준다. 없는 곳에서는 0으로 읽는다. */
const usage = llm instanceof Gemini ? llm.usage : null;

interface Tally {
  /** 온디바이스가 이미 맞힌 것. 폴백은 여기 오지 않는다. */
  solvedOnDevice: number;
  /** 폴백이 풀어 준 것. */
  solvedByLlm: number;
  /** 폴백도 못 푼 것. */
  stillMissed: number;
  positives: number;
  /** 답 없는 질의를 옳게 되물은 것. */
  correctlyRefused: number;
  /** 답 없는 질의인데 메뉴를 들이민 것. */
  falseConfident: { query: string; picked: string; why: string }[];
  negatives: number;
  llmCalls: number;
}

const tally: Tally = {
  solvedOnDevice: 0,
  solvedByLlm: 0,
  stillMissed: 0,
  positives: 0,
  correctlyRefused: 0,
  falseConfident: [],
  negatives: 0,
  llmCalls: 0,
};

const gained: string[] = [];
const missed: string[] = [];

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));

  const index = new MenuIndex(catalog);
  const embedding = NgramTfIdfProvider.build(index.documents());
  const onDevice = new SearchPipeline(index, DEFAULT_CONFIG, embedding);
  // 문턱을 없앤 두 번째 파이프라인. 폴백에 보여 줄 후보를 추리는 데만 쓴다.
  const wide = new SearchPipeline(
    index,
    resolveConfig({ search: { minConfidence: 0, maxCandidates: CANDIDATE_COUNT } }),
    embedding,
  );

  const candidatesFor = (query: string): AssistCandidate[] => {
    const result = wide.search(query);
    if (result.status !== "ok") return [];
    return result.candidates.flatMap((candidate) => {
      const menu = byId.get(candidate.menuId);
      if (!menu) return [];
      return [
        {
          menuId: menu.id,
          label: menu.label,
          ...(menu.path ? { path: menu.path } : {}),
          ...(menu.hint ? { hint: menu.hint } : {}),
        },
      ];
    });
  };

  console.log(`\n  ${site}`);

  for (const testCase of querySet.sites[site] ?? []) {
    tally.positives += 1;
    const result = onDevice.search(testCase.query);
    const top = result.status === "ok" ? byId.get(result.candidates[0]!.menuId)?.label : undefined;

    if (top === testCase.expect) {
      tally.solvedOnDevice += 1;
      continue;
    }

    // 온디바이스가 놓쳤다. 여기서만 LLM을 부른다.
    tally.llmCalls += 1;
    const picked = await assist(llm, testCase.query, candidatesFor(testCase.query));
    const label = picked.menuId ? byId.get(picked.menuId)?.label : null;

    if (label === testCase.expect) {
      tally.solvedByLlm += 1;
      gained.push(`${site}  "${testCase.query}" → ${label}`);
    } else {
      tally.stillMissed += 1;
      missed.push(
        `${site}  "${testCase.query}" → ${label ?? "없음"} (정답: ${testCase.expect})`,
      );
    }
  }

  for (const query of querySet.negative) {
    tally.negatives += 1;
    const result = onDevice.search(query);
    if (result.status === "ok") continue; // 온디바이스가 이미 잘못 확신한 경우

    tally.llmCalls += 1;
    const picked = await assist(llm, query, candidatesFor(query));
    if (picked.menuId === null) {
      tally.correctlyRefused += 1;
    } else {
      tally.falseConfident.push({
        query,
        picked: byId.get(picked.menuId)?.label ?? picked.menuId,
        why: picked.why,
      });
    }
  }
}

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(0)}%`;

console.log(
  [
    "",
    "  ── 런타임 LLM 폴백",
    "",
    `  정답 있는 질의 ${tally.positives}건`,
    `    온디바이스가 맞힘      ${tally.solvedOnDevice}  ${pct(tally.solvedOnDevice, tally.positives)}`,
    `    폴백이 풀어 줌        +${tally.solvedByLlm}  → 합계 ${pct(
      tally.solvedOnDevice + tally.solvedByLlm,
      tally.positives,
    )}`,
    `    그래도 못 찾음        ${tally.stillMissed}`,
    "",
    `  답 없는 질의 ${tally.negatives}건`,
    `    옳게 거절            ${tally.correctlyRefused}`,
    `    잘못 들이밂          ${tally.falseConfident.length}`,
    "",
    `  LLM 호출 ${tally.llmCalls}건 (질의 ${tally.positives + tally.negatives}건 중 ${pct(
      tally.llmCalls,
      tally.positives + tally.negatives,
    )})`,
    `  입력 ${(usage?.inputTokens ?? 0).toLocaleString()} · 출력 ${(usage?.outputTokens ?? 0).toLocaleString()} 토큰`,
    `  호출당 ${Math.round(
      ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)) /
        Math.max(1, usage?.requests ?? 1),
    )} 토큰`,
    "",
  ].join("\n"),
);

if (gained.length > 0) {
  console.log(`  얻은 것 ${gained.length}건`);
  for (const line of gained) console.log(`    ${line}`);
}
if (tally.falseConfident.length > 0) {
  console.log(`\n  답 없는 질의에 들이민 것 ${tally.falseConfident.length}건`);
  for (const item of tally.falseConfident) {
    console.log(`    "${item.query}" → ${item.picked}  ${item.why}`);
  }
}
if (missed.length > 0) {
  console.log(`\n  폴백도 못 푼 것 ${missed.length}건`);
  for (const line of missed) console.log(`    ${line}`);
}
console.log();
