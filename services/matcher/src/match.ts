import { cosineTopK, type VectorIndex } from "./vectors.js";

/**
 * 질의 하나를 받아 후보를 낸다 — **검색 → 재순위**.
 *
 * <p>무거운 것(인코더·재순위 모델)은 <b>주입 계약</b>으로 둔다. `SttProvider`나 `assist`와
 * 같은 가름이고 같은 이득을 준다 — 조립 판단이 모델 없이 CI에서 재진다.
 *
 * <p>층이 셋이고 <b>위의 둘은 없어도 된다.</b> 재순위가 죽으면 검색 결과가 그대로 나가고,
 * 카탈로그를 모르면 빈손으로 돌아온다. 원격 전체가 없어도 되는 층이므로(불변 규칙 9)
 * 그 안에서도 같은 규칙이 선다.
 */

/** 질의를 벡터로. 무거운 쪽은 `encoder.ts`에 있다. */
export interface QueryEncoder {
  readonly dim: number;
  /** 반환 벡터는 **정규화돼 있어야 한다** — `cosineTopK`가 내적만 한다. */
  encode(text: string): Promise<Float32Array>;
}

/** 교차 인코더 재순위. 없어도 된다. */
export interface Reranker {
  rerank(
    query: string,
    candidates: readonly { menuId: string; text: string }[],
  ): Promise<readonly { menuId: string; score: number }[]>;
}

export interface MatchDeps {
  /** 사이트 → 메뉴 벡터. 빌드 타임 산출물. */
  indexes: ReadonlyMap<string, VectorIndex>;
  encoder: QueryEncoder;
  reranker?: Reranker;
  /** 메뉴 → 재순위에 넘길 글. 재순위를 쓸 때만 필요하다. */
  texts?: ReadonlyMap<string, string>;
}

export interface MatchOptions {
  /** 검색기에서 받아 올 후보 수. */
  topK?: number;
  /**
   * 재순위에 넘길 수. **0이면 재순위를 아예 부르지 않는다.**
   *
   * <p>교차 인코더는 top-20에 0.5~2초가 걸린다. 고령 사용자에게 침묵은 고장이므로
   * 끌 수 있어야 하고, 그 값을 하는지는 `tune:neural`이 지연과 함께 잰다.
   */
  rerankTopK?: number;
}

/** 코어의 `NeuralMatch`와 같은 모양. **id와 점수뿐이다.** */
export interface MatchHit {
  menuId: string;
  score: number;
  rerankScore?: number;
}

export async function match(
  query: string,
  catalogId: string,
  deps: MatchDeps,
  options: MatchOptions = {},
): Promise<MatchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const index = deps.indexes.get(catalogId);
  /*
   * 벡터를 안 구운 사이트를 호스트가 열 수 있다. 던지면 그 사이트에서 검색이 통째로
   * 죽는데, 원격은 없어도 되는 층이다 — 빈손으로 돌아가면 로컬 결과가 그대로 쓰인다.
   */
  if (!index) return [];

  const encoded = await deps.encoder.encode(trimmed);
  const hits = cosineTopK(encoded, index, options.topK ?? 20);

  const rerankTopK = options.rerankTopK ?? 0;
  if (rerankTopK <= 0 || !deps.reranker || !deps.texts) {
    return hits.map((hit) => ({ menuId: hit.menuId, score: hit.score }));
  }

  return rerank(trimmed, hits, rerankTopK, deps);
}

async function rerank(
  query: string,
  hits: readonly { menuId: string; score: number }[],
  topK: number,
  deps: MatchDeps,
): Promise<MatchHit[]> {
  const head = hits.slice(0, topK);
  const candidates = head
    .map((hit) => ({ menuId: hit.menuId, text: deps.texts!.get(hit.menuId) ?? "" }))
    .filter((candidate) => candidate.text.length > 0);

  let scores: ReadonlyMap<string, number>;
  try {
    const reranked = await deps.reranker!.rerank(query, candidates);
    scores = new Map(reranked.map((r) => [r.menuId, r.score]));
  } catch {
    // 재순위가 죽어도 검색 결과가 나간다. 원격 안에서도 아래 층이 위 층을 살린다.
    return hits.map((hit) => ({ menuId: hit.menuId, score: hit.score }));
  }

  /*
   * 재순위 점수는 **따로 담는다.** 검색기의 코사인과 자가 다르므로 한 칸에 섞으면
   * core의 캘리브레이션이 무엇을 옮기는지 알 수 없게 된다.
   */
  const ordered = head
    .map((hit) => {
      const rerankScore = scores.get(hit.menuId);
      return rerankScore === undefined
        ? { menuId: hit.menuId, score: hit.score }
        : { menuId: hit.menuId, score: hit.score, rerankScore };
    })
    .sort((a, b) => (b.rerankScore ?? -Infinity) - (a.rerankScore ?? -Infinity));

  // 재순위에 안 넘어간 꼬리는 순서를 그대로 뒤에 붙인다.
  return [...ordered, ...hits.slice(topK).map((h) => ({ menuId: h.menuId, score: h.score }))];
}
