import type { MinUIConfig } from "../config.js";
import type { MenuId, MenuItem, RiskLevel, SlotExtractor, Slots } from "../types.js";
import type { SearchCandidate, SearchOutcome } from "./SearchPipeline.js";
import type { MatchStage } from "./stages.js";
import type { RepromptChoice } from "./reprompt.js";

/**
 * 음성/검색 결과를 화면 동작으로 바꾼다 — **기획안 §9.3의 안전 경계가 사는 곳.**
 *
 *   음성으로 가능: 메뉴 화면 열기, 수취인 프리필, 조회성 기능
 *   음성으로 불가: 이체 실행, 금액 확정, 인증 통과, riskLevel high 메뉴의 최종 확정
 *
 * 이것은 기술적 한계가 아니라 의도적으로 그은 선이다. 이유는 셋이다.
 *   ① 오인식된 금액의 이체는 되돌리기 어렵다. 조회는 틀려도 다시 하면 된다.
 *   ② 말만으로 송금이 끝나는 구조는 옆에서 시키는 대로 말하게 하는 공격에 약하다.
 *      주 사용자가 고령층인 만큼 이 리스크가 특히 무겁다.
 *   ③ 음성만으로 자금이 움직이는 기능은 금융권 보안 심사를 통과하기 어렵다.
 *
 * 이 함수를 거치지 않고 검색 결과로 화면을 여는 경로를 만들면 안 된다.
 * 규칙을 한 곳에 모아 두어야 테스트로 지킬 수 있다.
 */

export type VoiceAction =
  /** 바로 열어도 되는 경우 — 조회성 메뉴에 확신이 높을 때만. */
  | { kind: "open"; menuId: MenuId; prefill?: Slots }
  /**
   * 사용자가 눌러야 열린다. riskLevel high는 언제나 여기로 온다.
   *
   * <p><b>프리필이 붙지 않는다.</b> 어느 후보를 고를지 아직 모르므로 채울 값도 정해지지
   * 않는다. 사용자가 고른 뒤에 호스트가 `engine.prefillFor()`로 묻는다.
   */
  | { kind: "choose"; candidates: SearchCandidate[] }
  /** 알아듣지 못했다. 선택지를 주고 다시 묻는다. */
  | { kind: "reprompt"; prompt: string; choices: RepromptChoice[] };

export interface VoiceActionInput {
  outcome: SearchOutcome;
  /** 메뉴 ID → 메뉴. riskLevel을 보기 위해 필요하다. */
  menus: ReadonlyMap<MenuId, MenuItem>;
  config: MinUIConfig;
  /** STT가 준 신뢰도. 텍스트 검색이면 생략한다. */
  sttConfidence?: number;
  /** 호스트가 준 값 추출기 (M9). 없으면 프리필이 붙지 않는다. */
  slots?: SlotExtractor;
}

/**
 * 음성으로 자동 실행할 수 없는 위험도.
 *
 * <p><b>`medium`이 M11에서 들어왔다.</b> 그전까지 `riskLevel`은 "돈이 움직이는가"만 봤고,
 * 그래서 잔액·거래내역처럼 <b>읽기만 하는 화면</b>은 `low`라 확신이 높으면 확인 없이 열렸다.
 * 잠금 해제된 기기를 잠깐 쥔 사람이 "잔액 얼마야"로 볼 수 있다는 뜻이다 —
 * <b>돈은 안 나가지만 정보는 나간다.</b>
 *
 * <p>`high`로 올리지 않은 이유: `high`는 "음성으로 <b>완료</b>할 수 없다"는 뜻인데
 * 조회는 애초에 완료할 것이 없다. 둘을 같은 칸에 넣으면 무엇이 왜 막혔는지가 흐려지고,
 * §12.6이 기록한 실패(위험도별 임계값 — 정답인 high 메뉴가 함께 잘려 후보 3개 포함이
 * 85%→80%)처럼 <b>맞는 것까지 밀어낼</b> 수 있다.
 *
 * <p>`medium`은 자동 실행만 막는다. 후보로는 그대로 올라오고 사용자가 누르면 열린다.
 */
const CONFIRM_REQUIRED: ReadonlySet<RiskLevel> = new Set<RiskLevel>(["high", "medium"]);

/**
 * 이 단계가 1위를 올렸으면 확신과 무관하게 사용자가 누른다 (M11).
 *
 * <p>불변 규칙 8("LLM은 위험도를 낮추지 못한다")의 일반형이다 — <b>모델은 확신도 올리지
 * 못한다.</b> 화면은 이미 그렇게 하고 있었다: 도우미(`assist`)가 고른 것도 후보로만
 * 제시하고 자동으로 열지 않는다(`VoiceSearchSheet.tsx`). 그 판단이 화면에 흩어져 있으면
 * 다른 화면이 다르게 하고, §9.3이 한쪽에서만 지켜진다. 규칙이 있는 자리로 옮긴다.
 *
 * <p><b>이 한 줄이 위험 하나를 통째로 없앤다.</b> 원격 모델의 점수 분포는 로컬과 다르고
 * 캘리브레이션이 어긋날 수 있는데, 자동 실행이 원천 차단되므로 `autoOpenConfidence`(0.9)를
 * 다시 튜닝할 필요가 없다. 잃는 것도 없다 — 자동 실행은 로컬이 이미 확신한 경우에만
 * 일어나고, 그때는 `neural.consultBelow`가 원격을 아예 부르지 않는다.
 */
const NEVER_AUTO_OPEN: ReadonlySet<MatchStage> = new Set<MatchStage>(["neural"]);

export function resolveVoiceAction({
  outcome,
  menus,
  config,
  sttConfidence,
  slots,
}: VoiceActionInput): VoiceAction {
  const settings = config.search;

  // §9.2 — 신뢰도가 낮은 인식 결과는 후보를 보여 주지도 않고 되묻는다.
  // 틀린 후보를 그럴듯하게 내미는 것이 되묻는 것보다 나쁘다.
  if (sttConfidence !== undefined && sttConfidence < settings.minSttConfidence) {
    return reprompt(outcome);
  }

  if (outcome.status === "unclear") return reprompt(outcome);

  const candidates = outcome.candidates;
  const first = candidates[0];
  if (!first) return reprompt(outcome);

  const menu = menus.get(first.menuId);
  const needsConfirmation =
    menu === undefined ||
    CONFIRM_REQUIRED.has(menu.riskLevel) ||
    NEVER_AUTO_OPEN.has(first.matchedBy);

  /*
   * 후보가 여럿이면 사용자가 고른다 (기획안 F4).
   *
   * <p>**세는 것은 문턱을 넘은 후보뿐이다.** `search()`는 1위가 문턱을 넘으면 아래 것들을
   * 함께 돌려준다 — "이거 말씀하신 건가요" 목록에 보여 주기 위해서다. 그러나 문턱 아래
   * 점수는 그것만 있었다면 되물었을 점수이므로, 자동 실행 여부를 정할 때 그것을 "경쟁하는
   * 후보"로 세면 <b>확신이 분명한 경우까지 되묻게 된다.</b>
   *
   * <p>M7에서 실제로 그랬다. 학습이 다른 후보를 지우지 않게 고쳤더니 0.95짜리 학습 매칭에
   * 0.288짜리 유사도 잡음이 딸려 와서, 사용자가 직접 가르친 말이 영영 자동으로 열리지
   * 않게 됐다. 보여 주는 목록은 그대로 두고 <b>세는 기준만</b> 바꾼다.
   */
  const credible = candidates.filter((c) => c.score >= settings.minConfidence);
  if (credible.length > 1) return { kind: "choose", candidates };

  // 후보가 하나여도, 위험한 메뉴이거나 확신이 부족하면 사용자 확인을 거친다.
  if (needsConfirmation || first.score < settings.autoOpenConfidence) {
    return { kind: "choose", candidates };
  }

  /*
   * 여기까지 온 것만 프리필을 받는다 — 조회성 메뉴에 확신이 높아 바로 여는 경우다.
   * 되묻기와 후보 제시에는 붙이지 않는다. 못 알아들은 발화에서 뽑은 값은 근거가 없고,
   * 어느 후보를 고를지 모르는 상태에서 채울 값을 정할 수도 없다.
   */
  const prefill = extract(slots, outcome.query, first.menuId);
  return prefill ? { kind: "open", menuId: first.menuId, prefill } : { kind: "open", menuId: first.menuId };
}

/**
 * 호스트 추출기를 부른다. **던져도 음성 경로를 죽이지 않는다.**
 *
 * <p>프리필은 편의이지 기능의 전제가 아니다. 도우미가 죽어도 서비스가 도는 것과 같은
 * 판단이며, 값이 안 채워진 화면은 사용자가 채우면 되지만 열리지 않는 화면은 막다른 길이다.
 */
function extract(
  slots: SlotExtractor | undefined,
  query: string,
  menuId: MenuId,
): Slots | undefined {
  if (!slots) return undefined;
  try {
    const values = slots(query, menuId);
    return Object.keys(values).length > 0 ? values : undefined;
  } catch {
    return undefined;
  }
}

function reprompt(outcome: SearchOutcome): VoiceAction {
  if (outcome.status === "unclear") {
    return { kind: "reprompt", prompt: outcome.prompt, choices: outcome.choices };
  }
  return { kind: "reprompt", prompt: "다시 말씀해 주세요.", choices: [] };
}
