import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 임베딩 모델을 받아 둔다 (M11).
 *
 * <p>지운 `fetch:model`(Whisper 가중치 78MB)의 이름을 그대로 쓴다. 하는 일이 같기
 * 때문이다 — <b>저장소에 안 들어가는 무거운 것을 필요할 때 받아 온다.</b>
 *
 * <p>기본은 `multilingual-e5-small`이다. 130MB로 한국어 특화 모델(1GB대)보다 훨씬 가볍고,
 * <b>먼저 이것으로 게이트를 넘는지 본 다음</b> 못 넘으면 그때 큰 것을 잰다. 재 보지도
 * 않고 좋아 보이는 쪽으로 가는 것은 §16이 여러 번 기록한 실패와 같은 모양이다.
 *
 * <p>모델 이름을 인자로 받고 <b>메타를 파일로 남기는</b> 이유가 그것이다 — 모델을 갈아
 * 끼울 때 코드가 안 바뀌어야 `tune:neural`의 비교가 성립한다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, "../models");

/**
 * e5 계열은 질의와 문서에 서로 다른 접두를 붙여야 제 성능이 난다.
 * <b>이 값을 코드에 박지 않는다</b> — 모델마다 다르고, 갈아 끼울 때 여기만 바뀌어야 한다.
 */
const KNOWN: Record<string, { queryPrefix: string; passagePrefix: string; dim: number }> = {
  "Xenova/multilingual-e5-small": { queryPrefix: "query: ", passagePrefix: "passage: ", dim: 384 },
  "Xenova/multilingual-e5-base": { queryPrefix: "query: ", passagePrefix: "passage: ", dim: 768 },
  "Xenova/multilingual-e5-large": { queryPrefix: "query: ", passagePrefix: "passage: ", dim: 1024 },
  /*
   * BGE-m3 계열은 접두를 안 쓴다. 한국어 검색에서 e5보다 낫다고 알려져 있고,
   * 국내 한국어 임베딩(KURE 등)이 이것을 바탕으로 만들어졌다.
   * **그 평판이 이 카탈로그에서도 성립하는지가 M11이 재려는 것이다.**
   */
  "Xenova/bge-m3": { queryPrefix: "", passagePrefix: "", dim: 1024 },
  "onnx-community/bge-m3-ONNX": { queryPrefix: "", passagePrefix: "", dim: 1024 },
};

const model = process.argv[2] ?? "Xenova/multilingual-e5-small";
const meta = KNOWN[model];

if (!meta) {
  console.error(`
  모르는 모델이다: ${model}

  접두와 차원을 아는 모델만 받는다. 새 모델을 쓰려면 이 파일의 KNOWN에 먼저 적어라 —
  e5 계열에 접두를 빼먹으면 점수가 조용히 나빠지고, 원인을 찾는 데 며칠이 걸린다.

  아는 것: ${Object.keys(KNOWN).join(", ")}
`);
  process.exit(1);
}

console.log(`
  임베딩 모델 받기 — ${model}
  ${"─".repeat(60)}
`);

mkdirSync(MODELS, { recursive: true });

/*
 * transformers.js가 캐시 자리에 알아서 받는다. 여기서 하는 일은 **한 번 불러 보는 것**과
 * 메타를 남기는 것뿐이다 — 받다 말면 나중에 데모를 띄울 때 알게 되는데, 그때는 늦다.
 */
const { pipeline, env } = await import("@huggingface/transformers");
env.cacheDir = MODELS;
env.allowLocalModels = true;

const started = Date.now();

/*
 * 파일이 바뀔 때만 한 줄 찍는다. 처음에는 `\r`로 진행률을 덮어썼는데, 파이프로 넘기면
 * `\r`이 안 먹혀 출력이 179KB가 됐다. 로그를 읽을 사람에게 필요한 것은 진행률이 아니라
 * **무엇을 받고 있는가**다.
 */
let announced = "";
const extractor = await pipeline("feature-extraction", model, {
  dtype: "q8",
  progress_callback: (progress: { status?: string; file?: string }) => {
    if (progress.status !== "progress" || !progress.file || progress.file === announced) return;
    announced = progress.file;
    console.log(`  받는 중  ${progress.file}`);
  },
});

const output = await extractor([`${meta.queryPrefix}돈 보내고 싶어`], {
  pooling: "mean",
  normalize: true,
});
const dim = output.dims.at(-1) ?? 0;

writeFileSync(
  join(MODELS, "embed-model.json"),
  JSON.stringify({ model, ...meta, dim }, null, 2),
  "utf8",
);

console.log(`  받았다      ${model}`);
console.log(`  차원        ${dim}${dim === meta.dim ? "" : `  ← KNOWN의 ${meta.dim}과 다르다`}`);
console.log(`  걸린 시간   ${((Date.now() - started) / 1000).toFixed(1)}초`);
console.log(`  자리        tools/models/  (gitignore)`);

try {
  console.log(`  메타        tools/models/embed-model.json (${statSync(join(MODELS, "embed-model.json")).size}B)`);
} catch {
  // 크기를 못 읽어도 받은 것은 받은 것이다.
}

console.log(`
  ${"─".repeat(60)}
  다음: pnpm --filter tools build:vectors 로 사이트별 벡터를 굽는다.
`);
