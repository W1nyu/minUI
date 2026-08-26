import { describe, expect, it } from "vitest";
import {
  cosineTopK,
  dequantizeInt8,
  l2normalize,
  quantizeInt8,
  type VectorIndex,
} from "../src/vectors.js";

/**
 * 모델 없이 도는 절반.
 *
 * <p><b>이 파일이 onnx를 안 쓰는 것이 요점이다.</b> 검색 품질의 절반은 어떤 모델을
 * 쓰느냐가 아니라 벡터를 어떻게 정규화하고 자르고 되살리느냐가 정한다. 그런데 여기에
 * onnx가 붙으면 모델 가중치(수백 MB)가 있어야만 테스트가 돌고, 그러면 <b>CI에서 영영
 * 안 돈다.</b> 안 도는 테스트는 없는 테스트다.
 *
 * <p>그래서 인코더는 밖에 두고, 인코더가 <b>낸 숫자를 다루는 부분</b>만 여기서 잰다.
 * `packages/voice`가 브라우저 API를 구현체 안에만 두고 인터페이스를 밖에 둔 것과 같은 가름이다.
 */
describe("l2normalize", () => {
  it("길이를 1로 만든다 — 코사인을 내적으로 계산하기 위해서다", () => {
    const v = l2normalize(Float32Array.from([3, 4]));

    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });

  it("영벡터는 그대로 둔다 — 0으로 나누지 않는다", () => {
    // 뜻풀이가 빈 메뉴에서 실제로 나온다. 던지면 색인 굽기가 통째로 멈춘다.
    expect([...l2normalize(Float32Array.from([0, 0]))]).toEqual([0, 0]);
  });

  it("이미 정규화된 것은 안 바뀐다", () => {
    const v = l2normalize(Float32Array.from([1, 0, 0]));

    expect([...v]).toEqual([1, 0, 0]);
  });
});

describe("int8 양자화", () => {
  it("되살린 값이 원본에 가깝다", () => {
    // 크기를 1/4로 줄이는 대가가 이 오차다. 900개 × 384차원이 1.4MB → 357KB.
    const original = Float32Array.from([0.5, -0.25, 1, -1, 0]);
    const restored = dequantizeInt8(quantizeInt8(original));

    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 2);
    }
  });

  it("벡터마다 따로 눈금을 잡는다 — 전체 최댓값에 맞추면 작은 벡터가 뭉갠다", () => {
    const small = quantizeInt8(Float32Array.from([0.001, -0.002]));

    // 눈금이 벡터에 맞춰지므로 작은 값도 해상도를 잃지 않는다.
    const restored = dequantizeInt8(small);
    expect(restored[1]! / restored[0]!).toBeCloseTo(-2, 1);
  });

  it("영벡터도 왕복한다", () => {
    expect([...dequantizeInt8(quantizeInt8(Float32Array.from([0, 0, 0])))]).toEqual([0, 0, 0]);
  });
});

describe("cosineTopK", () => {
  /**
   * 색인을 손으로 적지 않고 <b>실제 양자화로 만든다.</b>
   *
   * <p>처음에는 int8 원시값(`127, 0, ...`)에 눈금을 1로 적어 뒀는데, 그러면 되살린 값이
   * 127이 되어 점수가 전부 1로 잘렸다. 산출 경로와 다른 모양의 픽스처는 재는 대상을
   * 재지 않는다.
   */
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

  //   a = (1, 0)   b = (0, 1)   c = (0.6, 0.8)
  const index = makeIndex([
    ["a", [1, 0]],
    ["b", [0, 1]],
    ["c", [0.6, 0.8]],
  ]);

  it("가장 가까운 것부터 낸다", () => {
    const hits = cosineTopK(Float32Array.from([1, 0]), index, 3);

    /*
     * b가 없는 것이 맞다. (0,1)은 질의와 직교해 코사인이 0이고, **0점짜리는 후보가
     * 아니다.** 그것을 후보로 올리면 캘리브레이션의 바닥이 할 일만 늘어난다.
     */
    expect(hits.map((h) => h.menuId)).toEqual(["a", "c"]);
  });

  it("k개만 낸다", () => {
    expect(cosineTopK(Float32Array.from([1, 0]), index, 1)).toHaveLength(1);
  });

  it("점수가 코사인이다", () => {
    const hits = cosineTopK(Float32Array.from([1, 0]), index, 3);

    expect(hits[0]!.score).toBeCloseTo(1, 2);
    expect(hits[1]!.score).toBeCloseTo(0.6, 1);
  });

  it("반대 방향은 후보가 아니다", () => {
    const hits = cosineTopK(Float32Array.from([-1, 0]), index, 3);

    expect(hits.every((h) => h.score > 0)).toBe(true);
  });

  it("차원이 안 맞으면 던진다 — 조용히 틀린 점수를 내는 것보다 낫다", () => {
    /*
     * 벡터는 빌드 타임 산출물이라 모델을 바꾸면 차원이 바뀐다. 그때 조용히 돌면
     * 검색이 이유 없이 나빠지고 원인을 찾는 데 며칠이 걸린다.
     */
    expect(() => cosineTopK(Float32Array.from([1, 0, 0]), index, 1)).toThrow(/차원/);
  });

  it("같은 점수면 색인 순서를 지킨다 — 같은 질의가 같은 순서를 내야 한다", () => {
    const tie = makeIndex([
      ["first", [1, 0]],
      ["second", [1, 0]],
    ]);

    expect(cosineTopK(Float32Array.from([1, 0]), tie, 2).map((h) => h.menuId)).toEqual([
      "first",
      "second",
    ]);
  });
});
