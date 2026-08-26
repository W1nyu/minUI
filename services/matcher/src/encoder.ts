import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { QueryEncoder } from "./match.js";
import { l2normalize } from "./vectors.js";

/**
 * 질의를 벡터로 — **여기만 onnx를 안다.**
 *
 * <p>이 파일이 얇은 것이 요점이다. 검색 품질의 절반을 정하는 판단(정규화·양자화·top-K·
 * 조립)은 전부 `vectors.ts`와 `match.ts`에 있고 모델 없이 재진다. 여기 있는 것은
 * <b>모델을 불러 숫자를 얻는 일</b>뿐이라, 모델을 갈아 끼울 때 이 파일만 바뀐다.
 *
 * <h3>접두를 코드에 박지 않는다</h3>
 * e5 계열은 질의에 `query: `, 문서에 `passage: `를 붙여야 제 성능이 난다. 그런데 그 값을
 * 여기 적어 두면 <b>모델을 바꿀 때 코드가 함께 바뀌고, 그러면 `tune:neural`의 비교가
 * 성립하지 않는다</b> — 무엇이 달라져서 점수가 변했는지 알 수 없게 된다. 그래서
 * `fetch:model`이 남긴 메타에서 읽는다.
 *
 * <p>접두를 빼먹으면 점수가 <b>조용히</b> 나빠진다. 던지지도 않고 그럴듯한 숫자가 나오므로
 * 원인을 찾는 데 며칠이 걸린다. 그것이 메타를 파일로 남기는 진짜 이유다.
 */

/**
 * 한 번에 모델에 넣을 문장 수.
 *
 * <p>32는 실측으로 고른 값이다 — 930개를 통째로 넣으면 700MB 할당에 실패하고,
 * 크면 패딩 때문에 짧은 라벨의 벡터가 나빠진다. 작으면 굽는 데 오래 걸릴 뿐 품질은
 * 안 나빠지므로, <b>의심스러우면 줄이는 쪽</b>이 맞다.
 */
const BATCH = 32;

export interface EmbedModelMeta {
  model: string;
  queryPrefix: string;
  passagePrefix: string;
  dim: number;
}

export function readMeta(modelDir: string): EmbedModelMeta {
  return JSON.parse(readFileSync(join(modelDir, "embed-model.json"), "utf8")) as EmbedModelMeta;
}

export interface TransformersEncoderOptions {
  /** `fetch:model`이 받아 둔 자리. 메타도 여기서 읽는다. */
  modelDir: string;
}

/**
 * 문서(메뉴) 쪽 인코더까지 함께 낸다.
 *
 * <p>질의와 문서가 <b>같은 모델·같은 접두 규칙</b>을 써야 코사인이 뜻을 갖는다.
 * 둘을 따로 만들 수 있게 두면 언젠가 한쪽만 바뀐다.
 */
export interface Encoders {
  query: QueryEncoder;
  /** 색인을 구울 때 쓴다. 여러 개를 한 번에 넘기는 편이 훨씬 빠르다. */
  encodePassages(texts: readonly string[]): Promise<Float32Array[]>;
  meta: EmbedModelMeta;
}

export async function createEncoders({
  modelDir,
}: TransformersEncoderOptions): Promise<Encoders> {
  const meta = readMeta(modelDir);

  /*
   * 동적 import다. 정적으로 두면 `vectors.ts`를 테스트하는 데도 onnx가 딸려 들어와
   * 모델 없이 도는 절반이 사라진다.
   */
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = modelDir;
  env.allowLocalModels = true;

  const extractor = await pipeline("feature-extraction", meta.model, { dtype: "q8" });

  /**
   * <b>반드시 잘라서 넣는다.</b>
   *
   * <p>처음에는 통째로 넣었는데, 신한 930개를 굽다 <b>700MB 할당에 실패</b>했다
   * (`Failed to allocate memory for requested buffer of size 700907520`). 한 배치의
   * 활성값이 `배치 × 최장길이 × 은닉차원`으로 커지기 때문이다.
   *
   * <p>더 나쁜 것은 <b>터지지 않았을 때</b>다. 배치가 크면 모든 문장이 그 배치의 최장
   * 길이로 패딩되는데, 메뉴 라벨은 길이 편차가 크다 — 두 글자짜리와 스무 글자짜리가
   * 한 배치에 들어간다. 구운 벡터가 조용히 나빠지고, 검색이 이유 없이 못 찾는다.
   * 실제로 그렇게 구운 색인이 "돈 부쳐"에 `신규`를 0.683으로 내밀었다.
   */
  async function encodeAll(texts: readonly string[], prefix: string): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const out: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += BATCH) {
      const batch = texts.slice(start, start + BATCH);
      const output = await extractor(
        batch.map((text) => `${prefix}${text}`),
        // 평균 풀링 + 정규화가 표준 사용법이다. 여기서 벗어나면 점수 분포가 달라진다.
        { pooling: "mean", normalize: true },
      );

      const flat = output.data as Float32Array;
      const dim = output.dims.at(-1) ?? meta.dim;

      for (let row = 0; row < batch.length; row++) {
        const slice = flat.slice(row * dim, (row + 1) * dim);
        // 모델이 이미 정규화했지만 한 번 더 한다 — 양자화 왕복 뒤에도 길이가 1이어야 한다.
        out.push(l2normalize(Float32Array.from(slice)));
      }
    }
    return out;
  }

  return {
    meta,
    query: {
      dim: meta.dim,
      async encode(text) {
        const [vector] = await encodeAll([text], meta.queryPrefix);
        return vector ?? new Float32Array(meta.dim);
      },
    },
    encodePassages: (texts) => encodeAll(texts, meta.passagePrefix),
  };
}
