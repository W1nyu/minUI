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
