import type { MenuId } from "../types.js";
import type { MenuIndex } from "./MenuIndex.js";
import type { SearchCandidate } from "./stages.js";

/**
 * 되묻기 선택지를 **후보에서 만든다** (M11, 기획안 §9.2).
 *
 * <h3>무엇이 문제였나</h3>
 * 지금 되묻기는 <b>질의를 아예 보지 않는다.</b> `categories().slice(0, 3)`을 그대로 낸다.
 * 신한은행에서 "돈 나가는 거 막아줘"라고 말한 사람이 "개인, 기업, 카드 중 어느 것인가요?"를
 * 듣는다. §9.2가 스스로 열어 둔 구멍이다:
 *
 * <blockquote>되묻기 선택지 개수는 아직 못 정했다. 신한은행의 카테고리가 36개인데 3개만
 * 보여 주면 길잡이가 되지 못하고, 10개로 늘리면 그 화면이 다시 탐색 문제가 된다.</blockquote>
 *
 * <h3>왜 생성이 아니라 선택인가</h3>
 * 자유 문장을 만들면 세 가지를 잃는다.
 * <ol>
 *   <li><b>잴 방법이 없다.</b> "좋은 질문이었나"에 정답이 없다. 이 프로젝트는 못 재는
 *       변경을 받지 않는다 — §16이 잰 것들의 무덤인 이유다
 *   <li><b>없는 메뉴 이름을 지어낼 수 있다.</b> §8.3이 `assist`를 안전하다고 말하는 근거가
 *       정확히 "자유 생성이 아니라 선택이라 없는 화면이 열리는 일이 구조적으로 불가능하다"이다.
 *       길을 잃은 사람에게 보여 주는 화면에서 그 근거를 버릴 이유가 없다
 *   <li><b>이미 후보 목록 자체가 질문이다.</b>
 * </ol>
 *
 * <p>§9.2의 진짜 구멍은 <b>무슨 말을 할까</b>가 아니라 <b>어느 셋을 화면에 놓을까</b>다.
 * 그것은 <b>가르기</b> 문제이고, 여기서 푸는 것이 그것이다.
 *
 * <h3>왜 M11에서만 가능한가</h3>
 * 가를 대상이 <b>신경망이 카탈로그 전체에서 회수한 후보</b>다. 로컬만으로는 되묻기가
 * 났을 때 후보 풀이 비어 있거나 잡음뿐이라 가를 것이 없다.
 */

export interface RepromptSettings {
  /** 화면에 놓을 선택지 수. 너무 많으면 그 화면이 다시 탐색 문제가 된다. */
  choiceCount: number;
  /** 이 무게에 못 미치는 묶음은 선택지가 되지 못한다. */
  minGroupMass: number;
  /** 가르는 데 쓸 후보 수. */
  poolSize: number;
  /** 갈래를 몇 칸까지 내려가 볼 것인가. */
  maxDepth: number;
}

export interface RepromptChoice {
  /** 화면에 보일 말. <b>카탈로그에 있는 글자다.</b> 지어내지 않는다. */
  label: string;
  /** 이 선택지를 누르면 보여 줄 메뉴들. <b>화면이 다시 검색하지 않는다.</b> */
  menuIds: MenuId[];
  /** 이 묶음이 가져간 후보 무게. 벤치마크가 표로 찍는다. */
  mass: number;
}

export interface Reprompt {
  prompt: string;
  choices: RepromptChoice[];
}

export function buildReprompt(
  pool: readonly SearchCandidate[],
  index: MenuIndex,
  settings: RepromptSettings,
): Reprompt {
  const best = bestSplit(pool.slice(0, settings.poolSize), index, settings);
  if (best.length >= 2) {
    /*
     * **고른 갈래는 통째로 보여 준다.**
     *
     * 처음에는 후보 풀에 있던 메뉴만 담았는데, 그러면 도달률이 후보 회수율에 갇힌다 —
     * 실측에서 정적 선택지 57.8%, 가른 것 25.9%로 <b>가른 쪽이 크게 졌다.</b>
     * 후보는 **어느 갈래를 물을지 고르는 데** 쓰는 것이지, 보여 줄 목록이 아니다.
     * 사용자가 "이체"를 골랐으면 이체 아래 전부를 볼 수 있어야 한다.
     */
    const expanded = best.map((choice) => ({
      ...choice,
      menuIds: index.menus
        .filter((menu) => menu.path.includes(choice.label))
        .map((menu) => menu.menuId),
    }));
    return { prompt: promptFor(expanded.map((c) => c.label)), choices: expanded };
  }

  /*
   * 가를 것이 없으면 지금까지처럼 카테고리 앞 세 개를 낸다.
   *
   * <p><b>오프라인 바닥이 그대로 남아야 한다.</b> 이 변경은 더하기이지 바꾸기가 아니다 —
   * 원격이 꺼져 있거나 후보가 비면 M11 이전과 같은 화면이 나온다.
   */
  const fallback = index.categories().slice(0, settings.choiceCount);
  return {
    prompt: promptFor(fallback),
    choices: fallback.map((label) => ({
      label,
      menuIds: index.menus.filter((menu) => menu.categoryLabel === label).map((m) => m.menuId),
      mass: 0,
    })),
  };
}

/**
 * 어느 깊이로 묶어야 <b>가장 고르게</b> 갈리는가.
 *
 * <p>한 묶음이 거의 전부를 가져가는 나눔은 아무것도 가르지 못한다 — "이체 중에 있나요?"라고
 * 물었는데 후보가 전부 이체 아래면 사용자는 아무 정보도 얻지 못한다. 그래서
 * <b>가장 작은 묶음의 무게를 최대로</b> 하는 깊이를 고른다.
 */
function bestSplit(
  pool: readonly SearchCandidate[],
  index: MenuIndex,
  settings: RepromptSettings,
): RepromptChoice[] {
  const byId = new Map(index.menus.map((menu) => [menu.menuId, menu]));
  const total = pool.reduce((sum, candidate) => sum + candidate.score, 0);
  if (total <= 0) return [];

  let best: RepromptChoice[] = [];
  let bestFloor = 0;

  for (let depth = 1; depth <= settings.maxDepth; depth++) {
    const groups = new Map<string, RepromptChoice>();

    for (const candidate of pool) {
      const menu = byId.get(candidate.menuId);
      const path = menu?.path ?? [];
      // 그 깊이에 갈래가 없는 메뉴는 이 나눔에 못 낀다. 억지로 넣으면 이름이 없다.
      const label = path[depth - 1];
      if (!label) continue;

      const group = groups.get(label) ?? { label, menuIds: [], mass: 0 };
      group.menuIds.push(candidate.menuId);
      group.mass += candidate.score;
      groups.set(label, group);
    }

    const kept = [...groups.values()]
      .filter((group) => group.mass / total >= settings.minGroupMass)
      .sort((a, b) => b.mass - a.mass || a.label.localeCompare(b.label))
      .slice(0, settings.choiceCount);

    if (kept.length < 2) continue;

    /*
     * 가장 작은 묶음의 무게가 이 나눔의 값이다. 평균이나 합이 아니라 최솟값을 쓰는 이유:
     * 95%짜리 하나와 5%짜리 하나로 갈린 것도 평균으로는 그럴듯해 보인다.
     */
    const floor = Math.min(...kept.map((group) => group.mass)) / total;
    if (floor > bestFloor) {
      bestFloor = floor;
      best = kept;
    }
  }

  return best;
}

/**
 * 열린 질문 대신 선택지를 준다 (§9.2).
 *
 * <p>"무엇을 도와드릴까요?"가 아니라 "이체, 조회 중에 찾으시는 게 있나요?"다.
 * 문구는 M11 전과 <b>글자까지 같다</b> — 바뀐 것은 무엇을 넣느냐뿐이다.
 */
function promptFor(labels: readonly string[]): string {
  if (labels.length === 0) return "다시 말씀해 주세요.";
  return `${labels.join(", ")} 중에 찾으시는 게 있나요?`;
}
