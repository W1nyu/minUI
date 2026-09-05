import type { MenuId } from "../types.js";
import { dot, extractFeatures, type FeatureContext, type FeatureName } from "./features.js";
import type { IndexedMenu } from "./MenuIndex.js";
import { DECISIVE, type SearchCandidate } from "./stages.js";

/**
 * 학습된 후보 재순위 (M23, 기획안 §8.3 ⑥).
 *
 * <h3>왜 이 자리인가</h3>
 *
 * <p>M22에서 두 번 실패했다. 사전확률은 후보의 <b>점수를 바꾸려</b> 했고, LLM 교정은
 * 후보를 <b>새로 만들려</b> 했다. 둘 다 잘못된 확신을 샀다.
 *
 * <p>그런데 실측이 가리키는 병목은 셋 다 아니다 — 실제 STT 출력 144줄에서
 * <b>오답 28건 중 16건은 정답이 이미 후보 1~3위에 있었다.</b> 회수가 아니라 순서다.
 *
 * <h3>이 파일이 지키는 계약 — `prior.ts`와 같다</h3>
 *
 * <ol>
 *   <li><b>순서만 바꾼다. 점수는 건드리지 않는다.</b> `score`를 만지면 되묻기 갈래의
 *       무게(`buildReprompt`)와 `autoOpenConfidence` 판정이 조용히 달라진다.
 *   <li><b>문턱을 넘은 후보들 안에서만</b> 재정렬한다. 문턱 아래는 손대지 않는다 —
 *       그래서 답 없는 질의의 잘못된 확신이 이 단계 때문에 <b>늘어나는 것은 구조적으로
 *       불가능하다.</b> 재서 확인할 일이 아니라 코드가 막는다.
 *   <li><b>`exact`가 있으면 아예 돌지 않는다.</b> `DECISIVE` 필터가 이미 다른 후보를
 *       걸러 냈고, 라벨이 글자까지 같은 것을 학습된 가중치가 밀어내면 §12.6 ②가 기록한
 *       사고와 같은 모양이 된다.
 *   <li><b>가중치가 비면 입력과 바이트 동일</b>이다. 적합 전에 켜도 아무것도 안 바뀐다.
 * </ol>
 *
 * <p>대가를 적어 둔다: 문턱 아래에 있던 정답과 인식이 망가진 질의(`수인아 나 보자`)는
 * 이 단계가 구제하지 못한다. 그것을 알고 고른 경계다.
 */

export interface RerankSettings {
  /**
   * 학습된 재순위를 쓸 것인가.
   *
   * <p>기본은 `false`다. `neural`·`phonology`·`prior`와 같은 처분으로, 사전 등록한
   * 게이트를 넘기 전에는 켜지 않는다.
   */
  enabled: boolean;
  /**
   * 특징 이름 → 가중치. `pnpm --filter tools fit:rerank`가 적합한 결과.
   *
   * <p>비어 있으면 아무것도 바뀌지 않는다. 숫자 여덟 개짜리 JSON이라 다른 언어로 포팅할 때
   * 그대로 실려 간다(불변 규칙 3).
   */
  weights: Partial<Record<FeatureName, number>>;
  /**
   * 지금 순서를 뒤집는 데 필요한 최소 차이.
   *
   * <p>0이면 아주 작은 차이로도 순서가 바뀐다. 학습이 확신하지 못하는 자리에서까지
   * 흔들면 사용자에게는 <b>이유 없이 순서가 달라지는 화면</b>이 된다.
   */
  margin: number;
  /**
   * 1위와 점수가 이만큼 안쪽인 후보들 사이에서만 재정렬한다.
   *
   * <p><b>왜 좁히는가.</b> 기존 순서는 선형이 아니라 <b>사전식 규칙</b>이다 — 점수 내림차순
   * → 단계 강도 → 자식이 갈래를 이김 → 카탈로그 순서. 선형 결합기는 그 계단을 표현하지
   * 못해서, 전체를 다시 세우면 재현조차 못 하고 무너진다(실측: 학습 세트 −3.5%p).
   *
   * <p>그런데 <b>점수가 거의 같은 자리</b>는 다르다. 거기서는 기존 규칙도 사실상 추측이고
   * (§12.6이 동점일 때만 자식·카탈로그 순서를 쓰는 이유가 그것이다), 학습이 보탤 것이 있다.
   * 이 값이 0이면 아무것도 안 바뀌고, 1이면 전부 다시 센다.
   */
  band: number;
}

/**
 * 문턱을 넘은 후보들을 학습된 점수로 다시 세운다.
 *
 * @param threshold `search.minConfidence`. 이 값을 사이에 두고 양쪽이 섞이지 않는다.
 */
export function rerank(
  candidates: readonly SearchCandidate[],
  menus: ReadonlyMap<MenuId, IndexedMenu>,
  settings: RerankSettings,
  context: FeatureContext,
  threshold: number,
): SearchCandidate[] {
  if (!settings.enabled) return [...candidates];
  if (Object.keys(settings.weights).length === 0) return [...candidates];

  // 정확 매칭이 하나라도 있으면 그 판단을 학습된 가중치로 흔들지 않는다.
  if (candidates.some((candidate) => DECISIVE.has(candidate.matchedBy))) return [...candidates];

  const passing: SearchCandidate[] = [];
  const rest: SearchCandidate[] = [];
  for (const candidate of candidates) {
    (candidate.score >= threshold ? passing : rest).push(candidate);
  }
  if (passing.length < 2) return [...candidates];

  /*
   * 1위와 점수가 `band` 안쪽인 것만 겨룬다. 나머지는 뒤에 그대로 붙는다 —
   * 점수가 뚜렷이 낮은 후보를 학습된 가중치가 끌어올리게 두지 않는다.
   */
  const top = passing[0]!.score;
  const contenders: SearchCandidate[] = [];
  const trailing: SearchCandidate[] = [];
  for (const candidate of passing) {
    (top - candidate.score <= settings.band ? contenders : trailing).push(candidate);
  }
  if (contenders.length < 2) return [...candidates];

  const scored = contenders.map((candidate, order) => {
    const menu = menus.get(candidate.menuId);
    return {
      candidate,
      order,
      value: menu === undefined ? 0 : dot(extractFeatures(candidate, menu, context), settings.weights),
    };
  });

  /*
   * **차이가 `margin`보다 작으면 지금 순서를 지킨다.** 정렬 비교자에서 마진을 쓰면
   * 순서가 이행적이지 않을 수 있어(a≈b, b≈c인데 a<c), 대신 <b>학습 점수로 정렬한 뒤</b>
   * 원래 1위가 넉넉히 지지 않았으면 되돌린다. 바뀔 때는 확실할 때만 바뀐다.
   */
  scored.sort((a, b) => b.value - a.value || a.order - b.order);

  const incumbent = scored.find((entry) => entry.order === 0)!;
  const challenger = scored[0]!;
  if (challenger.order !== 0 && challenger.value - incumbent.value < settings.margin) {
    return [...candidates];
  }

  return [...scored.map((entry) => entry.candidate), ...trailing, ...rest];
}
