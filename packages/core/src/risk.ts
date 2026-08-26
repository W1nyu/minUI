import type { RiskLevel } from "./types.js";

/** 위험도의 서열. `low < medium < high`. */
const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/**
 * 두 판정 중 **더 위험한 쪽**을 택한다 — 불변 규칙 8.
 *
 * <p>AGENTS.md: <b>"LLM은 위험도를 낮추지 못한다."</b> 규칙(정규식)이 위험하다고 본 것을
 * 모델이 안전하다고 내리지 못한다는 뜻이고, 그 반대는 허용한다 — 모델이 규칙보다 위험하게
 * 보면 그쪽을 따른다.
 *
 * <p><b>왜 여기 있는가.</b> 전에는 `services/enricher`에 있었는데, 그러면 이 규칙을 써야
 * 하는 곳(보강기·카탈로그 빌더)이 LLM 서비스에 기대게 된다. 규칙 8은 <b>코어의 불변
 * 규칙</b>이고 `RiskLevel`도 여기 있다. 판정을 쓰는 모든 곳이 한 함수를 보게 두는 것이
 * 이 규칙이 지켜지는지 확인할 수 있는 유일한 방법이다.
 *
 * <p>실제로 한 곳이 이 함수를 안 거치고 있었다 — `build-catalog`가 모델 값으로 규칙 값을
 * <b>덮어썼다.</b> 그래서 모델이 낮게 본 메뉴가 조용히 내려갔고, 규칙을 고쳐도
 * `*.ai.json`에 구워진 옛 값이 이겼다.
 */
export function combineRisk(byRule: RiskLevel, byModel: RiskLevel): RiskLevel {
  return RANK[byModel] > RANK[byRule] ? byModel : byRule;
}

/**
 * 음성·검색·AI가 **자동으로 실행할 수 없는** 위험도.
 *
 * <p><b>`medium`이 M11에서 들어왔다.</b> 그전까지 `riskLevel`은 "돈이 움직이는가"만 봤고,
 * 그래서 잔액·거래내역처럼 읽기만 하는 화면은 `low`라 확신이 높으면 확인 없이 열렸다.
 * 잠금 해제된 기기를 잠깐 쥔 사람이 "잔액 얼마야"로 볼 수 있다는 뜻이다 —
 * <b>돈은 안 나가지만 정보는 나간다.</b>
 *
 * <p>이 판정이 `risk.ts`에 있는 이유는 `combineRisk`와 같다. 화면마다 따로 정하면
 * §9.3이 한쪽에서만 지켜지고, 그것을 확인할 방법이 없어진다. 지금 이것을 쓰는 곳은
 * 둘이다 — 음성 행동 결정(`voiceAction.ts`)과 코파일럿 제안 검증(`copilot.ts`).
 */
const CONFIRM_REQUIRED: ReadonlySet<RiskLevel> = new Set<RiskLevel>(["high", "medium"]);

/** 이 메뉴는 사용자가 눌러야 열리는가. **모델이 이 값을 정하지 못한다.** */
export function requiresConfirm(riskLevel: RiskLevel): boolean {
  return CONFIRM_REQUIRED.has(riskLevel);
}
