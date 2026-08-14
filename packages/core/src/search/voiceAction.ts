import type { MinUIConfig } from "../config.js";
import type { MenuId, MenuItem, RiskLevel } from "../types.js";
import type { SearchCandidate, SearchOutcome } from "./SearchPipeline.js";

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
  | { kind: "open"; menuId: MenuId }
  /** 사용자가 눌러야 열린다. riskLevel high는 언제나 여기로 온다. */
  | { kind: "choose"; candidates: SearchCandidate[] }
  /** 알아듣지 못했다. 선택지를 주고 다시 묻는다. */
  | { kind: "reprompt"; prompt: string; choices: string[] };

export interface VoiceActionInput {
  outcome: SearchOutcome;
  /** 메뉴 ID → 메뉴. riskLevel을 보기 위해 필요하다. */
  menus: ReadonlyMap<MenuId, MenuItem>;
  config: MinUIConfig;
  /** STT가 준 신뢰도. 텍스트 검색이면 생략한다. */
  sttConfidence?: number;
}

/** 음성으로 자동 실행할 수 없는 위험도. */
const CONFIRM_REQUIRED: ReadonlySet<RiskLevel> = new Set<RiskLevel>(["high"]);

export function resolveVoiceAction({
  outcome,
  menus,
  config,
  sttConfidence,
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
  const needsConfirmation = menu === undefined || CONFIRM_REQUIRED.has(menu.riskLevel);

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

  return { kind: "open", menuId: first.menuId };
}

function reprompt(outcome: SearchOutcome): VoiceAction {
  if (outcome.status === "unclear") {
    return { kind: "reprompt", prompt: outcome.prompt, choices: outcome.choices };
  }
  return { kind: "reprompt", prompt: "다시 말씀해 주세요.", choices: [] };
}
