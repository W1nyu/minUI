import type { LlmClient } from "./llm.js";
import { ASKED_HINT_MAX, cleanHint } from "./hint.js";

/**
 * "이게 무슨 뜻이에요?" — 어려운 금융 용어를 그 자리에서 푼다.
 *
 * <p>고령 사용자가 막히는 벽은 둘이다. 첫째는 탐색(기획안 §2.2)이고 카드와 음성이 그것을
 * 푼다. <b>둘째는 어휘다</b> — `예수금`·`미수`·`반대매매`는 메뉴를 <b>찾는 것</b>과 별개로
 * <b>그게 뭔지 아는 것</b>이 막힌다. 도착해도 못 쓰면 도착한 것이 아니다.
 *
 * <p>빌드 타임 보강(`prompt.ts`)이 대부분을 미리 채워 두므로 여기까지 오는 것은 나머지다
 * (신한 930개 중 185개). 검색 폴백(`assist.ts`)과 같은 구조다 — <b>온디바이스가 가진
 * 것으로 안 될 때만</b> 부른다.
 *
 * <p>안전 경계. 뜻풀이는 조회성 정보라 §9.3 밖이지만, 금융 앱 안에서 모델이 상품을
 * 권하거나 투자 판단을 내리면 그것은 투자권유다. 프롬프트로 금지하고, 돌아온 것은
 * <b>빌드 타임과 같은 검증</b>(`cleanHint`)을 통과해야 한다.
 */

export interface ExplainTarget {
  label: string;
  /** 어디에 있는 메뉴인지. 같은 이름이 여러 갈래에 있을 때 뜻이 갈린다. */
  path?: readonly string[];
}

export const EXPLAIN_SYSTEM = `한국 금융 앱의 메뉴 이름 하나를 고령 사용자에게 설명합니다.

- **30자 안팎 한 줄**로 답하세요. 짧을수록 좋지만 뜻이 깎이면 안 됩니다
- 초등학생도 알아들을 생활어를 쓰세요. 어려운 말을 다른 어려운 말로 바꾸지 마세요
- 메뉴 이름을 그대로 되풀이하지 마세요. 그건 아무것도 풀어 주지 않습니다
- 모르면 빈 문자열로 두세요. 지어내지 마세요

절대 하지 않는 것:
- 상품을 **추천**하거나 무엇이 유리한지 말하지 않습니다
- **투자 판단**을 대신하지 않습니다 (사라/팔아라/오른다/내린다)
- 구체적인 **금액**·수익률·계좌번호·사람 이름을 만들어 넣지 않습니다

좋음: "예수금" → "바로 뺄 수 있는 돈이에요"
좋음: "반대매매" → "빌린 돈을 못 갚으면 주식을 대신 팝니다"
나쁨: "예수금" → "예수금입니다" (되풀이)
나쁨: "펀드" → "지금 사면 수익이 좋습니다" (추천·투자 판단)`;

/** 응답 형태를 강제한다. 파싱 실패를 애초에 줄인다. */
export const EXPLAIN_SCHEMA = {
  type: "object",
  properties: { hint: { type: "string" } },
  required: ["hint"],
} as const;

export function buildExplainPrompt(target: ExplainTarget): string {
  const where =
    target.path && target.path.length > 0 ? `\n어디에 있는지: ${target.path.join(" > ")}` : "";
  return `메뉴 이름: ${target.label}${where}`;
}

/**
 * 모델 답을 뜻풀이로. **빌드 타임과 같은 규칙을 통과해야 한다.**
 *
 * @returns 쓸 만하면 문자열, 아니면 `null`. `null`이면 호출자는 아무것도 보여 주지 않는다 —
 *   틀린 뜻풀이는 없는 것보다 나쁘다.
 */
export function parseExplainResponse(raw: unknown, target: ExplainTarget): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const hint = cleanHint(
    (raw as Record<string, unknown>)["hint"],
    target.label,
    ASKED_HINT_MAX,
  );
  return hint.length > 0 ? hint : null;
}

/** 한 번의 풀이. 호출자는 카탈로그에 `hint`가 없을 때만 부른다. */
export async function explain(
  llm: LlmClient,
  target: ExplainTarget,
): Promise<string | null> {
  const raw = await llm.json(
    EXPLAIN_SYSTEM,
    buildExplainPrompt(target),
    EXPLAIN_SCHEMA,
  );
  return parseExplainResponse(raw, target);
}
