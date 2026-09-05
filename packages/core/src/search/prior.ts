import type { MenuId, ScoreBreakdown } from "../types.js";
import { DECISIVE, type SearchCandidate } from "./stages.js";

/**
 * 사전확률 `P(의도)` (M22, 기획안 §8.3).
 *
 * <p>M21이 잡음 채널의 가능도를 지었다 — `P(들린말 | 의도)`. 그때 `confusion.ts`의 머리말에
 * 사전확률은 "기존 사용 이력 개인화가 이미 하는 일이므로 여기서 결합하지 않는다"고 적고
 * 미뤘다. 이 파일이 그 나머지 반쪽이다.
 *
 * <pre>
 *   P(의도 | 들린말)  ∝  P(들린말 | 의도)  ×  P(의도)
 *                        M21                  여기
 * </pre>
 *
 * <p><b>신호를 새로 모으지 않는다.</b> `RankingEngine`이 이미 빈도·최신성·시간 맥락을
 * 점수로 내고 있는데, 그것이 <b>카드 배치에만</b> 쓰이고 검색에는 한 번도 쓰인 적이 없다.
 *
 * <h3>이 파일이 지키는 경계</h3>
 *
 * <p>사전확률은 <b>문턱을 넘은 후보들의 순서만</b> 바꾼다. 문턱 아래는 아예 건드리지
 * 않는다 — 그래서 "답이 없어야 할 질의를 자신 있게 여는 일"이 이 단계 때문에 늘어나는
 * 것은 <b>구조적으로 불가능하다.</b> 재서 확인할 일이 아니라 타입과 테스트가 막는다.
 *
 * <p>계획서에는 "문턱을 넘는 힘은 <i>작아야</i> 한다"고 적었는데, 구현하면서 <b>아예 없게</b>
 * 하는 편이 낫다고 판단했다. 잃는 것은 문턱 아래에 있던 정답을 사전확률로 건지는 경우뿐이고,
 * 얻는 것은 §12.6이 공들여 지킨 "잘못된 확신 0"이 측정이 아니라 보증이 되는 것이다.
 */

/** 메뉴별 사전확률. 0..1. 합이 1일 필요는 없다 — 순서를 정하는 데만 쓴다. */
export type MenuPrior = ReadonlyMap<MenuId, number>;

export interface PriorSettings {
  /**
   * 사전확률을 검색에 쓸 것인가.
   *
   * <p>기본은 `false`다. `neural`·`phonology`와 같은 처분으로, 사전 등록한 게이트를
   * 넘기 전에는 켜지 않는다.
   */
  enabled: boolean;
  /**
   * 사전확률이 점수를 얼마나 끌어올릴 수 있는가. `score × (1 + priorWeight × prior)`.
   *
   * <p>이 값이 커도 문턱은 못 넘는다 — 위 경계가 따로 막는다. 이것이 정하는 것은
   * <b>이미 통과한 후보들 사이의 순서</b>뿐이다.
   */
  priorWeight: number;
  /**
   * 이 아래의 사전확률은 없는 것으로 본다.
   *
   * <p>한두 번 열어 본 메뉴가 사전확률 행세를 하면 개인화가 아니라 잡음이다.
   * `contextBoost`가 축마다 `minObservations`로 같은 일을 한다.
   */
  floor: number;
}

/**
 * 랭킹 점수를 사전확률로 옮긴다.
 *
 * <p><b>가장 많이 쓴 것을 1로 두는 상대 척도다.</b> 절대 확률이 아니다 — 필요한 것은
 * "이 사람 기준으로 얼마나 익숙한가"이지 빈도의 절대값이 아니고, 사용자마다 사용량이
 * 열 배씩 차이 나는데 절대값으로 재면 적게 쓰는 사람에게는 사전확률이 영영 안 생긴다.
 *
 * <p>기록이 없으면 <b>빈 것을 돌려준다.</b> 콜드 스타트에서 아무것도 기울이지 않는다.
 */
export function toPrior(
  scores: readonly ScoreBreakdown[],
  settings: PriorSettings,
): MenuPrior {
  let max = 0;
  for (const score of scores) {
    if (score.total > max) max = score.total;
  }
  if (max <= 0) return new Map();

  const prior = new Map<MenuId, number>();
  for (const score of scores) {
    if (score.total <= 0) continue;
    const value = score.total / max;
    if (value < settings.floor) continue;
    prior.set(score.menuId, value);
  }
  return prior;
}

/**
 * 후보에 사전확률을 얹는다. **순서만 바꾸고 판정은 바꾸지 않는다.**
 *
 * @param threshold `search.minConfidence`. 이 값을 사이에 두고 양쪽이 섞이지 않는다.
 */
export function applyPrior(
  candidates: readonly SearchCandidate[],
  prior: MenuPrior,
  settings: PriorSettings,
  threshold: number,
): SearchCandidate[] {
  if (!settings.enabled || prior.size === 0) return [...candidates];

  return candidates.map((candidate) => {
    /*
     * **정확 매칭에는 걸지 않는다.** 라벨이 질의와 글자까지 같은데 "자주 쓰는 다른 메뉴"가
     * 그것을 밀어내면 §12.6 ②가 기록한 사고와 같은 모양이 된다 — 점수가 아니라 판단이
     * 틀린 것이라 점수만 보고는 잡히지 않는다.
     */
    if (DECISIVE.has(candidate.matchedBy)) return candidate;

    const value = prior.get(candidate.menuId);
    if (value === undefined) return candidate;

    /*
     * **문턱 아래는 손대지 않는다.** 넘겨 주지 않는 것에 더해 아예 건드리지 않는 이유는
     * 되묻기 때문이다 — `buildReprompt`가 후보 점수를 갈래의 무게로 쓰므로, 여기서
     * 점수를 만지면 되묻기 선택지가 조용히 달라진다. 재 보지 않은 변화를 끼워 넣지 않는다.
     */
    if (candidate.score < threshold) return candidate;

    // 1.0은 정확 매칭의 자리다. 사전확률이 그 자리를 침범하지 못한다.
    const score = Math.min(1, candidate.score * (1 + settings.priorWeight * value));
    if (score === candidate.score) return candidate;

    return { ...candidate, score };
  });
}
