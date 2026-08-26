import type { Reranker } from "./match.js";

/**
 * 교차 인코더 재순위 — **여기만 onnx를 안다** (`encoder.ts`와 같은 가름).
 *
 * <h3>왜 필요한가 — 실측이 가리켰다</h3>
 * 원격 검색의 회수 곡선이 이렇게 나왔다 (semantic-focus 558건):
 * <pre>
 *   recall@1    12.4%
 *   recall@20   50.9%    ← 재순위가 고를 수 있는 천장
 *   recall@50   67.6%
 * </pre>
 * <b>찾긴 찾았는데 순위를 못 매긴다.</b> 4배 차이이고, 교차 인코더가 정확히 이 자리의
 * 도구다 — 질의와 후보를 <b>함께</b> 넣어 한 번에 읽으므로, 따로 인코딩해 코사인을 재는
 * 것보다 훨씬 잘 가른다.
 *
 * <h3>원시 로짓을 쓴다</h3>
 * `text-classification` 파이프라인은 시그모이드를 씌워 <b>전부 1.0으로 포화</b>시킨다.
 * 실측에서 정답도 1.0, 오답도 1.0이었다. 그래서 모델을 직접 부르고 로짓을 읽는다.
 *
 * <pre>
 *   +1.885  "돈 보내고 싶어"        × 계좌이체 송금       ← 정답
 *   -9.643  "돈 보내고 싶어"        × 환율조회            ← 오답
 * </pre>
 *
 * <h3>모델 선택</h3>
 * `bge-reranker-base`는 이름이 중국어·영어지만 XLM-R 바탕이라 한국어를 읽는다 — 위 수치가
 * 그 증거다. `mxbai-rerank-xsmall`도 재 봤는데 한국어에서 정답과 오답을 뒤집었다
 * (착오송금 -3.24 vs 펀드몰 -3.30). <b>이름이 아니라 재 보고 골랐다.</b>
 */

/** 한 번에 모델에 넣을 쌍의 수. `encoder.ts`의 BATCH와 같은 이유로 자른다. */
const BATCH = 16;

export interface TransformersRerankerOptions {
  modelDir: string;
  /** 기본은 실측으로 고른 것. 바꾸려면 재고 나서 바꾼다. */
  model?: string;
}

export async function createReranker({
  modelDir,
  model = "Xenova/bge-reranker-base",
}: TransformersRerankerOptions): Promise<Reranker> {
  // 동적 import — 정적으로 두면 `vectors.ts` 테스트에도 onnx가 딸려 들어온다.
  const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import(
    "@huggingface/transformers"
  );
  env.cacheDir = modelDir;
  env.allowLocalModels = true;

  const tokenizer = await AutoTokenizer.from_pretrained(model);
  const net = await AutoModelForSequenceClassification.from_pretrained(model, { dtype: "q8" });

  return {
    async rerank(query, candidates) {
      const out: { menuId: string; score: number }[] = [];

      for (let start = 0; start < candidates.length; start += BATCH) {
        const batch = candidates.slice(start, start + BATCH);
        const inputs = tokenizer(
          batch.map(() => query),
          { text_pair: batch.map((c) => c.text), padding: true, truncation: true } as never,
        );
        const { logits } = await net(inputs);
        const scores = logits.data as Float32Array;

        batch.forEach((candidate, row) => {
          // 로짓 그대로 넘긴다. 자를 맞추는 일은 core가 한다 (`calibrate`).
          out.push({ menuId: candidate.menuId, score: scores[row] ?? -Infinity });
        });
      }

      return out;
    },
  };
}
