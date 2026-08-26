/**
 * 벡터를 다루는 부분 — **모델 없이 돈다.**
 *
 * <p>검색 품질의 절반은 어떤 모델을 쓰느냐가 아니라 벡터를 어떻게 정규화하고 자르고
 * 되살리느냐가 정한다. 그런데 이 파일에 onnx가 붙으면 모델 가중치(수백 MB)가 있어야만
 * 테스트가 돌고, 그러면 <b>CI에서 영영 안 돈다.</b> 안 도는 테스트는 없는 테스트다.
 *
 * <p>그래서 인코더는 `encoder.ts`에 두고 여기는 <b>인코더가 낸 숫자만</b> 다룬다.
 * `packages/voice`가 브라우저 API를 구현체 안에만 두고 인터페이스를 밖에 둔 것과 같은 가름이다.
 */

/**
 * 사이트 하나의 메뉴 벡터. **빌드 타임 산출물이다.**
 *
 * <p>int8로 저장하는 이유는 크기다 — 930개 × 384차원을 float32로 두면 1.4MB인데
 * int8이면 357KB가 된다. 기획안 §8.3이 온디바이스 임베딩을 뺀 근거가 "546KB vs 100MB대"였고,
 * 그 숫자와 나란히 놓을 수 있어야 한다.
 */
export interface VectorIndex {
  version: 1;
  dim: number;
  menuIds: string[];
  /** 벡터마다 하나. 되살릴 때 곱한다. */
  scale: Float32Array;
  /** `menuIds.length × dim` 크기. 행 우선. */
  data: Int8Array;
}

export interface VectorHit {
  menuId: string;
  /** 코사인. 0..1. */
  score: number;
}

/**
 * 길이를 1로 만든다.
 *
 * <p>정규화해 두면 코사인이 그냥 내적이 된다 — 질의 하나에 메뉴 900개를 재는 자리에서
 * 나눗셈 900번이 사라진다.
 */
export function l2normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;

  const length = Math.sqrt(sum);
  // 0으로 나누지 않는다. 뜻풀이가 빈 메뉴에서 실제로 나오고, 던지면 색인 굽기가 멈춘다.
  if (length === 0) return vector;

  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! / length;
  return out;
}

/** 양자화 결과 한 줄. `VectorIndex`에 쌓기 전의 모양. */
export interface QuantizedVector {
  scale: number;
  data: Int8Array;
}

/**
 * float32 → int8.
 *
 * <p><b>눈금을 벡터마다 따로 잡는다.</b> 색인 전체의 최댓값에 맞추면 값이 작은 벡터가
 * 몇 단계 안에 뭉개진다 — 짧은 라벨의 임베딩이 그런 모양이 되기 쉽고, 그러면 짧은 이름의
 * 메뉴만 조용히 검색에서 나빠진다.
 */
export function quantizeInt8(vector: Float32Array): QuantizedVector {
  let peak = 0;
  for (const value of vector) peak = Math.max(peak, Math.abs(value));

  if (peak === 0) return { scale: 0, data: new Int8Array(vector.length) };

  const scale = peak / 127;
  const data = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) data[i] = Math.round(vector[i]! / scale);
  return { scale, data };
}

/** int8 → float32. */
export function dequantizeInt8({ scale, data }: QuantizedVector): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! * scale;
  return out;
}

/**
 * 질의 벡터에 가장 가까운 메뉴 k개.
 *
 * <p>질의는 미리 정규화해 넘긴다. 메뉴 쪽은 색인을 구울 때 정규화해 뒀으므로
 * 내적이 곧 코사인이다.
 *
 * <p><b>음수 점수는 내지 않는다.</b> 반대 방향을 가리키는 벡터는 후보가 아니고,
 * 그것을 후보로 올리면 캘리브레이션의 바닥(`neural.scoreFloor`)이 할 일이 늘어난다.
 */
export function cosineTopK(query: Float32Array, index: VectorIndex, k: number): VectorHit[] {
  if (query.length !== index.dim) {
    /*
     * 조용히 도는 것보다 던지는 편이 낫다. 벡터는 빌드 타임 산출물이라 모델을 바꾸면
     * 차원이 바뀌는데, 그때 맞춰 자르고 계속 돌면 검색이 이유 없이 나빠지고
     * 원인을 찾는 데 며칠이 걸린다.
     */
    throw new Error(`질의 차원 ${query.length}이 색인 차원 ${index.dim}과 다르다`);
  }

  const hits: VectorHit[] = [];
  for (let row = 0; row < index.menuIds.length; row++) {
    const offset = row * index.dim;
    const scale = index.scale[row]!;
    if (scale === 0) continue;

    let dot = 0;
    for (let d = 0; d < index.dim; d++) dot += query[d]! * index.data[offset + d]!;
    dot *= scale;

    if (dot <= 0) continue;
    hits.push({ menuId: index.menuIds[row]!, score: Math.min(1, dot) });
  }

  /*
   * 동점이면 색인 순서를 지킨다. `Array.prototype.sort`는 안정 정렬이므로 비교자가
   * 0을 내면 원래 순서가 남는다 — 같은 질의가 늘 같은 순서를 내야 한다는 요구
   * (`SearchPipeline`의 결정론 테스트와 같은 이유).
   */
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}
