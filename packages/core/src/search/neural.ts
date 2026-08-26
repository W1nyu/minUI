import type { MenuId } from "../types.js";
import { DECISIVE, STAGE_STRENGTH, type SearchCandidate } from "./stages.js";

/**
 * 원격 신경망 검색 (M11, 기획안 §8.3 ③').
 *
 * <h3>왜 `EmbeddingProvider`가 아닌가</h3>
 * `EmbeddingProvider`의 계약은 "색인은 빌드 타임 산출물이고, 네트워크 호출은 어느
 * 구현에서도 없다"이다. 그 문장은 지금도 참이어야 한다 — 오프라인 바닥이 그것으로
 * 지탱된다. 원격 검색은 그 인터페이스의 <b>구현체가 아니라 다른 층의 별도 단계</b>다.
 * 섞으면 바닥이 썩는다.
 *
 * <h3>왜 `assist`가 아닌가</h3>
 * `assist`는 <b>이미 가진 후보 중</b> 하나를 고른다. 여기는 <b>로컬이 0점을 준 메뉴를</b>
 * 데려온다. "돈 보내다"와 "이체"는 글자가 하나도 안 겹쳐 n-gram이 0을 주고, 그래서
 * 후보 목록에 애초에 없다. 고르게 해서는 그것을 되찾을 수 없다.
 *
 * <h3>판단이 전부 여기 있는 이유</h3>
 * 비동기 코드는 픽스처로 재기 어렵고 다른 언어로 옮길 때 통째로 다시 써야 한다.
 * 그래서 <b>이 파일은 순수하고 동기다.</b> 네트워크와 예외는 `MinUIEngine`의 얇은 껍데기가,
 * 기다림의 상한은 시계를 가진 `packages/react`가 진다. 캘리브레이션과 병합 규칙은
 * `fixtures/neural-merge.json`이 잰다.
 */

/** 원격이 돌려준 것. <b>id와 점수뿐이다</b> — 라벨도 힌트도 오지 않는다. */
export interface NeuralMatch {
  menuId: MenuId;
  /** 검색기 원점수. 대개 코사인. <b>자는 모델마다 다르다</b> — 맞추는 일은 여기가 한다. */
  score: number;
  /** 재순위 모델이 있었다면 그 원점수. 없으면 생략. */
  rerankScore?: number;
}

/**
 * 질의 하나를 원격에 묻는다.
 *
 * <p>`assist`와 같은 모양의 계약이다 — <b>엔진은 이것이 신경망인지 사전인지 사람인지
 * 모른다.</b> URL도 키도 모델 이름도 여기로 오지 않는다 (불변 규칙 9).
 */
export type NeuralRetriever = (query: string) => Promise<readonly NeuralMatch[]>;

export interface NeuralSettings {
  /** 코어 기본은 꺼짐. 호스트가 켠다. */
  enabled: boolean;
  /** 이 아래 원점수는 0으로 죽인다. */
  scoreFloor: number;
  /** 이 위는 1로 붙인다. */
  scoreCeiling: number;
  /** 옮긴 뒤 곱한다. `semanticWeight`와 같은 역할·같은 이유. */
  weight: number;
  /** 원격에서 받아 쓸 후보 수 상한. */
  maxMatches: number;
  /** 로컬 1위가 이 값 이상이면 원격을 부르지 않는다. */
  consultBelow: number;
  /**
   * 재순위 점수의 바닥·천장. **둘 다 있어야 재순위를 쓴다.**
   *
   * <p>교차 인코더의 로짓은 코사인과 <b>자가 완전히 다르다</b> — 코사인은 0.6~0.9에
   * 몰려 있고 로짓은 -10~+2로 벌어진다. 같은 `scoreFloor`로 옮기면 전부 0이 되거나 전부
   * 1이 된다. 다른 자를 쓰는 두 점수에는 두 개의 보정이 필요하다.
   *
   * <p>유도 방법은 `scoreFloor`와 같다 — 튜닝 세트의 부정 질의가 받은 최고 로짓 위에
   * 바닥을 놓는다. <b>고르는 값이 아니라 나오는 값이다.</b>
   *
   * <p>없으면(둘 중 하나라도) 재순위 점수를 무시하고 검색 점수로 보정한다. 재순위를
   * 안 켠 호스트에 로짓이 섞여 들어와도 조용히 이상해지지 않게 하기 위해서다.
   */
  rerankFloor?: number;
  rerankCeiling?: number;
  /**
   * 원격을 기다릴 상한(ms).
   *
   * <p><b>이 값을 지키는 것은 core가 아니다.</b> core는 Node·브라우저 전역에 손대지
   * 않으므로(불변 규칙 1) 시간을 잴 수 없다 — `portability.test.ts`가 이것을 강제한다.
   * 상한은 시계를 가진 층(`packages/react`의 `MinUIProvider`)이 씌우고, 시간이 넘으면
   * `retrieve`가 거부한다. core는 거부를 로컬 결과로 받는다.
   *
   * <p>값이 그럼에도 여기 있는 이유는 규칙 3이다 — 다른 언어로 포팅할 때 그 층이 같은
   * 값을 같은 자리에서 읽어야 한다. 튜닝 값이 코드에 흩어지면 포팅에서 잃는다.
   */
  timeoutMs: number;
}

/**
 * 원점수를 로컬 점수와 같은 자로 옮긴다.
 *
 * <p><b>이것이 M11에서 가장 조용히 실패할 수 있는 자리다.</b> 코사인은 무관한 메뉴에도
 * 0.6~0.7을 준다. `minConfidence: 0.4`는 n-gram의 희소한 분포(대부분 정확히 0)에 맞춰
 * 고른 값이라, 원점수를 그대로 들이면 "날씨 어때"가 아무 메뉴나 0.68로 집는다.
 * 그러면 <b>"답 없는 질의 100건 중 97건 옳게 거절"이 무너진다</b> — 정확도보다 지키기
 * 어려운 쪽이고, 이 프로젝트가 임계값을 0.30 대신 0.40으로 고른 이유와 같은 저울이다.
 *
 * <p>절단 아핀 사상을 고른 이유는 네 가지다.
 * <ol>
 *   <li><b>단조다.</b> 순서를 못 바꾸므로 회수를 악화시킬 수 없고, 문턱이 어디서 무는지만
 *       바꾼다. 그래서 회수와 거절을 따로 잴 수 있다
 *   <li><b>무관을 정확히 0으로 보낸다.</b> 거절률을 지키는 것은 바닥 하나다
 *   <li><b>JSON 데이터다.</b> 불변 규칙 3 — 다른 언어로 포팅해도 그대로 넘어간다
 *   <li><b>바닥은 고르는 값이 아니라 나오는 값이다.</b> 부정 질의 20건 × 5사이트의
 *       top-1 원점수 95분위에서 유도한다 (`tune:neural`이 그 과정을 출력에 남긴다)
 * </ol>
 *
 * <p>천장이 필요한 이유는 따로 있다. 거의 같은 이름(`이체` ↔ `이체하기`)에 코사인이
 * 0.99를 주는데, 그것을 그대로 두면 <b>정확 매칭과 구분되지 않는 점수</b>가 된다.
 * 그 위의 차이는 순서에만 쓰고 점수로는 세지 않는다.
 */
export function calibrate(raw: number, settings: NeuralSettings): number {
  const span = settings.scoreCeiling - settings.scoreFloor;
  // 설정이 뒤집혀 있으면 아무것도 통과시키지 않는다. 실수로 문을 여는 쪽보다 닫는 쪽이 낫다.
  if (span <= 0) return 0;

  const t = (raw - settings.scoreFloor) / span;
  return Math.min(1, Math.max(0, t)) * settings.weight;
}

/**
 * 이 후보를 무슨 자로 잴 것인가.
 *
 * <p>재순위 점수가 있고 그 보정이 설정돼 있으면 <b>재순위를 믿는다.</b> 교차 인코더는
 * 질의와 후보를 함께 읽으므로 따로 인코딩해 코사인을 재는 것보다 훨씬 잘 가른다 —
 * 실측에서 정답 +1.9, 오답 -9.6으로 <b>11점</b> 벌어졌다. 코사인의 0.08과 비교가 안 된다.
 *
 * <p>그래서 코사인이 높아도 재순위가 아니라고 하면 아닌 것이다. 회수기는 20개를 데려오는
 * 일까지만 하고, 그중 무엇인지는 재순위가 정한다.
 */
function calibrateMatch(match: NeuralMatch, settings: NeuralSettings): number {
  if (
    match.rerankScore !== undefined &&
    settings.rerankFloor !== undefined &&
    settings.rerankCeiling !== undefined
  ) {
    return calibrate(match.rerankScore, {
      ...settings,
      scoreFloor: settings.rerankFloor,
      scoreCeiling: settings.rerankCeiling,
    });
  }
  return calibrate(match.score, settings);
}

/**
 * 로컬 후보와 원격 후보를 하나의 풀로 합친다.
 *
 * <p>순서는 점수 내림차순, 동점이면 근거가 강한 단계(`STAGE_STRENGTH`). 자식이 갈래를
 * 이기는 마지막 동점 처리는 `SearchPipeline`이 자기 비교자로 다시 한다 — 그것은
 * 카탈로그를 알아야 하는 판단이라 여기 둘 수 없다.
 *
 * @param known 카탈로그에 실제로 있는 메뉴. 벡터는 빌드 타임 산출물이라 <b>카탈로그보다
 *   오래됐을 수 있고</b>, 없는 메뉴를 후보로 올리면 화면이 열 수 없는 것을 제시한다.
 * @param query 정규화된 질의. 원격이 준 후보의 `matchedTerm`이 된다.
 */
export function mergeNeural(
  local: readonly SearchCandidate[],
  remote: readonly NeuralMatch[],
  settings: NeuralSettings,
  known: ReadonlySet<MenuId>,
  query: string,
): SearchCandidate[] {
  /*
   * 정확 매칭이 있으면 원격을 통째로 버린다.
   *
   * 사전이 확실하다고 말한 것을 원격 유사도로 다시 흔들 이유가 없다 — `DECISIVE`가
   * 로컬에서 하던 판단과 같은 판단이고 같은 근거다. 이 자리에서 한 번 더 거르는 이유는,
   * 로컬 풀이 이미 정확 매칭만 남긴 상태로 오기 때문에 원격 후보를 그냥 이어 붙이면
   * 그 필터가 무효가 되기 때문이다.
   */
  if (local.some((candidate) => DECISIVE.has(candidate.matchedBy))) {
    return [...local];
  }

  const byMenu = new Map<MenuId, SearchCandidate>();
  for (const candidate of local) byMenu.set(candidate.menuId, candidate);

  const incoming: SearchCandidate[] = [];
  for (const match of remote) {
    if (!known.has(match.menuId)) continue;

    const score = calibrateMatch(match, settings);
    if (score <= 0) continue;

    incoming.push({
      menuId: match.menuId,
      score,
      matchedBy: "neural",
      /*
       * 보여 줄 말은 질의 자신이다. 원격이 준 것은 id와 점수뿐이라 근거로 쓸 표현이
       * 없고, 없는 것을 지어내면 사용자가 자기가 하지도 않은 말을 자기 말로 읽는다.
       */
      matchedTerm: query,
    });
  }

  // 원격 안에서 먼저 자른다. 로컬 후보가 상한을 잡아먹으면 안 된다.
  incoming.sort((a, b) => b.score - a.score);
  for (const candidate of incoming.slice(0, settings.maxMatches)) {
    const existing = byMenu.get(candidate.menuId);
    if (existing && !weakerThan(existing, candidate)) continue;
    byMenu.set(candidate.menuId, candidate);
  }

  return [...byMenu.values()].sort(
    (a, b) => b.score - a.score || STAGE_STRENGTH[b.matchedBy] - STAGE_STRENGTH[a.matchedBy],
  );
}

/**
 * 자리를 내줘야 하는가.
 *
 * <p>점수가 같으면 <b>사람이 붙인 동의어가 이긴다.</b> 불변 규칙 10의 근거를 점수
 * 체계로 지키는 자리다 — 실측에서 사람이 쓴 동의어는 80%, 모델이 만든 것은 27%였다.
 * 같은 점수라면 사람 쪽이 더 나은 내기다.
 */
function weakerThan(existing: SearchCandidate, incoming: SearchCandidate): boolean {
  if (existing.score !== incoming.score) return existing.score < incoming.score;
  return STAGE_STRENGTH[existing.matchedBy] < STAGE_STRENGTH[incoming.matchedBy];
}
