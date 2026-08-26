import { describe, expect, it, vi } from "vitest";
import { match, type MatchDeps } from "../src/match.js";
import { l2normalize, quantizeInt8, type VectorIndex } from "../src/vectors.js";

function makeIndex(rows: [string, number[]][]): VectorIndex {
  const dim = rows[0]![1].length;
  const scale = new Float32Array(rows.length);
  const data = new Int8Array(rows.length * dim);
  rows.forEach(([, values], row) => {
    const q = quantizeInt8(l2normalize(Float32Array.from(values)));
    scale[row] = q.scale;
    data.set(q.data, row * dim);
  });
  return { version: 1, dim, menuIds: rows.map(([id]) => id), scale, data };
}

const INDEX = makeIndex([
  ["transfer.now", [1, 0]],
  ["inquiry.balance", [0.8, 0.6]],
  ["settings.limit", [0.6, 0.8]],
]);

function deps(overrides: Partial<MatchDeps> = {}): MatchDeps {
  return {
    indexes: new Map([["kbstar", INDEX]]),
    encoder: {
      dim: 2,
      encode: async () => l2normalize(Float32Array.from([1, 0])),
    },
    texts: new Map([
      ["transfer.now", "계좌이체 송금"],
      ["inquiry.balance", "잔액조회"],
      ["settings.limit", "한도변경"],
    ]),
    ...overrides,
  };
}

/**
 * 조립. **모델 없이 잰다.**
 *
 * <p>인코더와 재순위 모델을 주입 계약으로 둔 이유가 이것이다 — `SttProvider`나 `assist`와
 * 같은 가름이고, 같은 이득을 준다. 무거운 것을 밖에 두면 판단이 CI에서 재진다.
 */
describe("match", () => {
  it("가장 가까운 것부터 낸다", async () => {
    const hits = await match("돈보내다", "kbstar", deps());

    expect(hits[0]!.menuId).toBe("transfer.now");
  });

  it("**응답에는 id와 점수뿐이다**", async () => {
    /*
     * 기획안 §11.1이 `/api/assist`에 대해 주장하던 것을 여기서는 실제로 지킨다.
     * (그 주장은 사실이 아니었고 M11이 문서를 고친다 — Task 21.)
     *
     * 라벨이나 뜻풀이를 함께 돌려주면 화면이 그것을 쓰기 시작하고, 그 순간 서버가
     * 카탈로그의 일부를 들고 있는 셈이 된다. 이식 계약이 넓어진다.
     */
    const hits = await match("돈보내다", "kbstar", deps());

    for (const hit of hits) {
      expect(Object.keys(hit).sort()).toEqual(["menuId", "score"]);
    }
  });

  it("모르는 카탈로그면 빈손으로 돌아온다 — 던지지 않는다", async () => {
    /*
     * 호스트가 벡터를 안 구운 사이트를 열 수 있다. 던지면 그 사이트에서 검색이
     * 통째로 죽는데, 원격은 <b>없어도 되는 층</b>이다 (불변 규칙 9).
     */
    expect(await match("돈보내다", "없는사이트", deps())).toEqual([]);
  });

  it("질의가 비면 인코더를 부르지 않는다", async () => {
    const encode = vi.fn();
    await match("   ", "kbstar", deps({ encoder: { dim: 2, encode } }));

    expect(encode).not.toHaveBeenCalled();
  });

  it("rerankTopK가 0이면 재순위 모델을 부르지 않는다", async () => {
    /*
     * 교차 인코더는 top-20에 0.5~2초가 걸린다. 고령 사용자에게 침묵은 고장이므로
     * **끌 수 있어야 한다.** 끄는 길이 살아 있는지 테스트가 지킨다.
     */
    const rerank = vi.fn();
    await match("돈보내다", "kbstar", deps({ reranker: { rerank } }), { rerankTopK: 0 });

    expect(rerank).not.toHaveBeenCalled();
  });

  it("재순위 모델이 순서를 바꾼다", async () => {
    const hits = await match(
      "돈보내다",
      "kbstar",
      deps({
        reranker: {
          rerank: async (_query, candidates) =>
            // 검색기가 꼴찌로 둔 것을 1등으로 올린다.
            candidates.map((c, i) => ({ menuId: c.menuId, score: i })),
        },
      }),
      { rerankTopK: 3 },
    );

    expect(hits[0]!.menuId).toBe("settings.limit");
  });

  it("재순위 모델이 죽어도 검색 결과가 나온다", async () => {
    // 원격 안에서도 아래 층이 위 층을 살린다. 규칙 9의 같은 모양.
    const hits = await match(
      "돈보내다",
      "kbstar",
      deps({ reranker: { rerank: () => Promise.reject(new Error("모델 없음")) } }),
      { rerankTopK: 3 },
    );

    expect(hits[0]!.menuId).toBe("transfer.now");
  });

  it("재순위 점수는 rerankScore로 따로 담는다", async () => {
    /*
     * 검색기 점수와 재순위 점수는 자가 다르다. 한 칸에 섞으면 core의 캘리브레이션이
     * 무엇을 옮기는지 알 수 없게 된다 — `NeuralMatch`가 두 칸을 둔 이유다.
     */
    const hits = await match(
      "돈보내다",
      "kbstar",
      deps({
        reranker: { rerank: async (_q, c) => c.map((x) => ({ menuId: x.menuId, score: 9 })) },
      }),
      { rerankTopK: 3 },
    );

    expect(hits[0]!.rerankScore).toBe(9);
    expect(hits[0]!.score).not.toBe(9);
  });
});
