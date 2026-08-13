import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Whisper 모델을 내려받아 데모가 직접 서빙하게 한다.
 *
 * <p>`pnpm --filter tools fetch:model [--model <id>] [--dtype <q8|q4|fp32>]`
 *
 * <p>안 받아도 동작한다 — transformers.js가 Hugging Face CDN에서 바로 받는다.
 * 그런데도 받아 두는 이유가 셋 있다.
 * <ul>
 *   <li><b>시연이 남의 서버에 걸리지 않는다.</b> 발표 자리에서 CDN이 느리거나 막히면
 *       음성 시연이 통째로 날아간다
 *   <li><b>측정이 재현된다.</b> §12.2-C 비교를 하려면 매번 같은 가중치여야 한다
 *   <li><b>"온디바이스"라는 말이 정직해진다.</b> 첫 실행에 남의 CDN을 부르는 것을
 *       온디바이스라고 부르기는 어렵다
 * </ul>
 *
 * <p>산출물은 저장소에 넣지 않는다(73MB). `.gitignore`에 있고, 필요할 때 이 스크립트로
 * 다시 만든다 — 수집 원본과 달리 <b>재현이 한 줄로 되는 것</b>은 굳이 담지 않는다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(HERE, "../../demos/public/models");

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};

const model = flag("model", "onnx-community/whisper-base");
const dtype = flag("dtype", "q8");

/** transformers.js가 dtype을 파일 이름으로 바꾸는 규칙. */
const SUFFIX: Record<string, string> = {
  fp32: "",
  fp16: "_fp16",
  q8: "_quantized",
  int8: "_int8",
  uint8: "_uint8",
  q4: "_q4",
};

const suffix = SUFFIX[dtype];
if (suffix === undefined) {
  console.error(`\n  모르는 dtype: ${dtype} (${Object.keys(SUFFIX).join(" · ")})\n`);
  process.exit(1);
}

/*
 * 토크나이저 파일은 모델마다 있는 것이 다르다. 없으면 건너뛴다 —
 * 전부 있어야 한다고 두면 모델을 바꿀 때마다 스크립트가 깨진다.
 */
const REQUIRED = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  `onnx/encoder_model${suffix}.onnx`,
  `onnx/decoder_model_merged${suffix}.onnx`,
];
const OPTIONAL = [
  "added_tokens.json",
  "special_tokens_map.json",
  "merges.txt",
  "vocab.json",
  "normalizer.json",
];

const outDir = join(OUT_ROOT, ...model.split("/"));
const base = `https://huggingface.co/${model}/resolve/main/`;

console.log(`\n  ${model} · ${dtype}\n  → ${outDir}\n`);

let downloaded = 0;
let skipped = 0;
let bytes = 0;

for (const [file, required] of [
  ...REQUIRED.map((f) => [f, true] as const),
  ...OPTIONAL.map((f) => [f, false] as const),
]) {
  const target = join(outDir, file);

  // 이미 받은 것은 다시 받지 않는다. 73MB를 매번 다시 끌어올 이유가 없다.
  const existing = await stat(target).catch(() => null);
  if (existing?.isFile() && existing.size > 0) {
    skipped += 1;
    bytes += existing.size;
    continue;
  }

  const response = await fetch(base + file);
  if (!response.ok) {
    if (required) {
      console.error(`  ✗ ${file} — ${response.status}. 모델 이름과 dtype을 확인하세요.`);
      process.exit(1);
    }
    continue;
  }

  const body = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);

  downloaded += 1;
  bytes += body.byteLength;
  console.log(`  ✓ ${file}  ${(body.byteLength / 1_048_576).toFixed(1)}MB`);
}

console.log(
  [
    "",
    `  받음 ${downloaded}개 · 이미 있던 것 ${skipped}개 · 합계 ${(bytes / 1_048_576).toFixed(1)}MB`,
    "",
    "  데모는 이 파일들을 /models/ 로 서빙한다. 없으면 CDN에서 받는다.",
    "",
  ].join("\n"),
);
