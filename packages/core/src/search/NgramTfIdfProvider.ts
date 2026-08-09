import type { MenuId } from "../types.js";
import type { EmbeddingProvider, IndexDocument } from "./EmbeddingProvider.js";

/** 직렬화된 색인. `tools/build-search-index.ts`가 만들어 번들에 넣는다. */
export interface SerializedNgramIndex {
  version: 1;
  gramSizes: number[];
  /** n-gram → IDF 가중치 */
  idf: Record<string, number>;
  /** 메뉴 ID → { n-gram: 정규화된 TF-IDF 성분 } */
  vectors: Record<MenuId, Record<string, number>>;
}

const DEFAULT_GRAM_SIZES = [2, 3];

/**
 * 문자 n-gram TF-IDF 코사인 유사도.
 *
 * 문장 임베딩 모델 대신 이걸로 시작하는 이유는 기획안 §14의 번들 크기 리스크다.
 * 다국어 문장 임베딩 모델은 최소 100MB대인데, 그 무게는 "온디바이스로 다 끝낸다"는
 * 이 프로젝트의 주장과 정면으로 충돌한다. 문자 n-gram은 색인이 수십 KB이고
 * 런타임 의존성이 0이다.
 *
 * 한국어에서 문자 n-gram이 잘 듣는 이유도 있다. 조사·어미가 붙어 어절이 변형되어도
 * 어간의 문자 조각은 그대로 남는다("이체하기" ↔ "이체를" 모두 "이체"를 포함).
 * 형태소 분석기 없이도 이 정도는 잡힌다.
 *
 * 못 하는 것은 분명하다 — "돈"과 "금액"처럼 문자가 겹치지 않는 동의 관계는 모른다.
 * 그것은 카탈로그의 `synonyms`가 담당한다. 두 방식이 서로의 빈틈을 메우는 구성이다.
 */
export class NgramTfIdfProvider implements EmbeddingProvider {
  readonly #gramSizes: number[];
  readonly #idf: Map<string, number>;
  readonly #vectors: Map<MenuId, Map<string, number>>;

  private constructor(
    gramSizes: number[],
    idf: Map<string, number>,
    vectors: Map<MenuId, Map<string, number>>,
  ) {
    this.#gramSizes = gramSizes;
    this.#idf = idf;
    this.#vectors = vectors;
  }

  static build(
    documents: readonly IndexDocument[],
    gramSizes: number[] = DEFAULT_GRAM_SIZES,
  ): NgramTfIdfProvider {
    const docGrams = documents.map((doc) => ({
      menuId: doc.menuId,
      grams: countGrams(doc.terms, gramSizes),
    }));

    // IDF — 드문 조각일수록 변별력이 크다.
    const documentFrequency = new Map<string, number>();
    for (const { grams } of docGrams) {
      for (const gram of grams.keys()) {
        documentFrequency.set(gram, (documentFrequency.get(gram) ?? 0) + 1);
      }
    }

    const total = Math.max(1, docGrams.length);
    const idf = new Map<string, number>();
    for (const [gram, count] of documentFrequency) {
      idf.set(gram, Math.log((total + 1) / (count + 1)) + 1);
    }

    const vectors = new Map<MenuId, Map<string, number>>();
    for (const { menuId, grams } of docGrams) {
      vectors.set(menuId, normalizeVector(weight(grams, idf)));
    }

    return new NgramTfIdfProvider(gramSizes, idf, vectors);
  }

  static fromJSON(data: SerializedNgramIndex): NgramTfIdfProvider {
    const idf = new Map(Object.entries(data.idf));
    const vectors = new Map<MenuId, Map<string, number>>();
    for (const [menuId, vector] of Object.entries(data.vectors)) {
      vectors.set(menuId, new Map(Object.entries(vector)));
    }
    return new NgramTfIdfProvider([...data.gramSizes], idf, vectors);
  }

  toJSON(): SerializedNgramIndex {
    return {
      version: 1,
      gramSizes: [...this.#gramSizes],
      idf: Object.fromEntries(this.#idf),
      vectors: Object.fromEntries(
        [...this.#vectors].map(([menuId, vector]) => [menuId, Object.fromEntries(vector)]),
      ),
    };
  }

  similarity(query: string): Map<MenuId, number> {
    const queryVector = normalizeVector(
      weight(countGrams([query], this.#gramSizes), this.#idf),
    );

    const out = new Map<MenuId, number>();
    if (queryVector.size === 0) return out;

    for (const [menuId, vector] of this.#vectors) {
      let dot = 0;
      // 짧은 쪽을 돌면 25개 메뉴 × 수십 그램 규모에서 충분히 빠르다.
      const [small, large] =
        queryVector.size <= vector.size ? [queryVector, vector] : [vector, queryVector];
      for (const [gram, value] of small) {
        const other = large.get(gram);
        if (other !== undefined) dot += value * other;
      }
      if (dot > 0) out.set(menuId, Math.min(1, dot));
    }

    return out;
  }
}

/**
 * 표현마다 따로 n-gram을 뽑는다. 이어 붙인 뒤 자르면 표현의 경계를 넘는 가짜 조각
 * ("잔액보기"+"통장확인" → "기통")이 생겨 잡음이 된다.
 */
function countGrams(terms: readonly string[], sizes: readonly number[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const term of terms) {
    if (term.length === 0) continue;
    for (const size of sizes) {
      if (term.length < size) {
        // 그램보다 짧은 표현은 통째로 한 조각으로 둔다. 그러지 않으면
        // "돈" 같은 한 글자 표현이 색인에서 사라진다.
        counts.set(term, (counts.get(term) ?? 0) + 1);
        continue;
      }
      for (let i = 0; i + size <= term.length; i++) {
        const gram = term.slice(i, i + size);
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
      }
    }
  }

  return counts;
}

function weight(
  counts: Map<string, number>,
  idf: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [gram, count] of counts) {
    // 색인에 없는 조각은 IDF를 모른다. 가장 드문 것으로 취급하지 않고 버린다 —
    // 오타 한 번이 점수를 지배하는 것을 막기 위해서다.
    const w = idf.get(gram);
    if (w === undefined) continue;
    out.set(gram, (1 + Math.log(count)) * w);
  }
  return out;
}

function normalizeVector(vector: Map<string, number>): Map<string, number> {
  let sumSquares = 0;
  for (const value of vector.values()) sumSquares += value * value;
  if (sumSquares === 0) return vector;

  const length = Math.sqrt(sumSquares);
  const out = new Map<string, number>();
  for (const [gram, value] of vector) out.set(gram, value / length);
  return out;
}
