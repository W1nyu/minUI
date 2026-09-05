import { jamoSimilarity } from "./hangul.js";
import { weightedJamoSimilarity, type ConfusionCosts } from "./confusion.js";
import type { IndexedMenu } from "./MenuIndex.js";
import { STAGE_STRENGTH, type SearchCandidate } from "./stages.js";

/**
 * 후보 하나를 숫자 여덟 개로 옮긴다 (M23, 기획안 §8.3 ⑥).
 *
 * <h3>왜 특징인가</h3>
 *
 * <p>지금 후보의 순서를 정하는 것은 <b>손으로 고른 상수들</b>이다 — `containmentScore` 0.90,
 * `partialScore` 0.80, `phoneticWeight` 0.95, `semanticWeight` 0.85,
 * `termSpecificityFloor` 0.80, 그리고 `STAGE_STRENGTH`의 순위. `tune:search`가 그중 둘을
 * 격자 탐색했고 나머지는 사람이 골랐다.
 *
 * <p>실측이 말하는 병목이 정확히 거기다. 실제 STT 출력 144줄에서 <b>오답 28건 중 16건은
 * 정답이 이미 후보 1~3위에 있었다.</b> 검색이 못 찾은 것이 아니라 순서를 잘못 매겼다.
 *
 * <h3>특징을 여덟 개로 묶어 둔 이유</h3>
 *
 * <p>표본이 질의 400개 규모다. 특징을 늘리면 학습이 <b>외운다.</b> 그리고 여덟 개 전부
 * `SearchCandidate`와 `IndexedMenu`에 이미 있는 값이라 <b>새로 계산하는 것이 없다</b> —
 * 재순위가 지연을 물지 않는 이유다.
 *
 * <p>학습(`tools`)과 추론(여기)이 <b>같은 함수</b>를 쓴다. 두 벌로 두면 적합한 가중치와
 * 배포된 가중치가 다른 것을 설명하게 된다.
 */

/** 특징 이름. 가중치 JSON의 열쇠이자 리포트의 열 이름이다. */
export const FEATURE_NAMES = [
  "score",
  "stage",
  "coverage",
  "jamo",
  "sound",
  "hasChildren",
  "depth",
  "margin",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/** 특징 벡터. 이름을 열쇠로 두는 이유는 가중치 JSON이 사람이 읽을 수 있어야 해서다. */
export type Features = Record<FeatureName, number>;

/** 한 질의 안에서 후보들이 공유하는 값. 후보마다 다시 계산하지 않는다. */
export interface FeatureContext {
  /** 정규화된 질의. */
  normalized: string;
  /** 발음 표기로 옮긴 질의 (M21). 꺼져 있으면 빈 문자열이다. */
  sound: string;
  /** 이 질의에서 가장 높은 점수. `margin`의 기준이다. */
  topScore: number;
  /** 학습된 자모 혼동 비용 (M21). 비면 균일 편집거리와 같다. */
  confusion: ConfusionCosts;
}

/**
 * 깊이를 나눌 상한. 계층이 이보다 깊어도 특징 값은 1에서 멈춘다.
 *
 * <p>특징을 0..1 안에 두는 이유는 가중치를 사람이 읽을 수 있게 하기 위해서다 —
 * 스케일이 제각각이면 큰 가중치가 중요한 특징을 뜻하지 않게 된다.
 */
const MAX_DEPTH = 6;

/**
 * 후보 하나의 특징을 뽑는다. **순수 함수** — 같은 입력에 늘 같은 값이다.
 *
 * <p>값은 전부 0..1로 맞춘다. `score`와 `jamo`·`sound`는 원래 그 범위이고,
 * 나머지는 여기서 나눈다.
 */
export function extractFeatures(
  candidate: SearchCandidate,
  menu: IndexedMenu,
  context: FeatureContext,
): Features {
  const term = candidate.matchedTerm;

  /*
   * 표현이 질의를 얼마나 덮는가. `termSpecificityFloor`가 손으로 하던 일의 학습판이다 —
   * "이체 한도 늘려줘"에 동의어 "이체"가 통째로 걸리는 것과, 라벨 "이체한도"가 걸리는 것을
   * 가른다.
   */
  const coverage =
    context.normalized.length === 0 || term.length === 0
      ? 0
      : Math.min(1, term.length / context.normalized.length);

  /*
   * 소리 특징은 M21이 지은 것을 그대로 쓴다. 질의 쪽 발음 표기가 없으면(발음 표기가 꺼져
   * 있으면) 0이다 — 없는 신호를 지어내지 않는다.
   */
  const sound =
    context.sound.length === 0
      ? 0
      : Math.max(
          0,
          ...menu.sounds.map((heard) =>
            weightedJamoSimilarity(context.sound, heard, context.confusion),
          ),
        );

  return {
    score: clamp01(candidate.score),
    stage: STAGE_STRENGTH[candidate.matchedBy] / 5,
    coverage,
    jamo: clamp01(jamoSimilarity(context.normalized, term)),
    sound: clamp01(sound),
    /*
     * **갈래인가 자식인가.** §12.6이 <b>동점일 때만</b> 쓰던 신호를 항상 쓴다.
     * 실패 16건의 대부분이 이 축이다 — `휴면예금` vs `휴면예금조회`,
     * `출금가능금액` vs `출금가능금액조회`. 갈래는 목적지이기도 하지만 이름표이기도 하다.
     */
    hasChildren: menu.hasChildren ? 1 : 0,
    depth: Math.min(1, menu.path.length / MAX_DEPTH),
    /*
     * 1위와의 거리. 후보 하나만 보고는 알 수 없는 것 — "혼자 튀는 1위"와 "다 비슷한
     * 후보 셋"은 다른 상황이고, 재순위가 개입할 값어치도 다르다.
     */
    margin: clamp01(context.topScore - candidate.score),
  };
}

/** 특징 벡터와 가중치의 내적. 재순위 점수는 이것 하나다. */
export function dot(features: Features, weights: Partial<Record<FeatureName, number>>): number {
  let total = 0;
  for (const name of FEATURE_NAMES) total += features[name] * (weights[name] ?? 0);
  return total;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
