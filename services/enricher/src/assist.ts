import type { Gemini } from "./gemini.js";

/**
 * 온디바이스가 못 찾았을 때 LLM이 **사용자가 한 말을 보고** 고른다.
 *
 * <p>빌드 타임에 동의어를 미리 붙이는 방식은 실측에서 해로웠다 — 사람 것만 쓸 때 85%가
 * 전 메뉴에 LLM 동의어를 얹으니 67%로 떨어졌다. 미리 붙이려면 <b>모든 가능한 표현을 미리
 * 알아맞혀야</b> 하고, 빗나간 것들이 서로를 방해한다.
 *
 * <p>런타임은 사정이 다르다. `"돈을 보내다"`라는 실제 발화를 보고 그 자리에서 고른다.
 * 미리 맞힐 필요가 없다. 그리고 <b>못 찾았을 때만</b> 도므로 대부분의 질의는 여기까지
 * 오지 않는다 — `"계좌이체"`라고 치면 온디바이스가 잡고 끝난다.
 *
 * <p>안전 경계는 그대로다. 이 함수는 <b>후보 목록에서 고르기만 한다</b> — 자유 생성이
 * 아니라 선택이라 없는 화면이 열리는 일이 구조적으로 불가능하고, 고른 뒤에도
 * `resolveVoiceAction`이 `riskLevel: high`를 자동 실행에서 막는다(기획안 §9.3).
 */

export interface AssistCandidate {
  menuId: string;
  label: string;
  path?: readonly string[];
  /** 어려운 말 풀이. 있으면 모델이 고르는 데 도움이 된다. */
  hint?: string;
}

export const ASSIST_SYSTEM = `사용자가 금융 앱에서 원하는 기능을 말했습니다.
아래 후보 메뉴 중에서 사용자가 가려는 곳을 하나 고르세요.

- 번호만 답하세요
- **맞는 것이 없으면 -1**을 답하세요. 억지로 고르지 마세요
- 금융과 무관한 말("날씨", "노래 틀어줘")이면 반드시 -1입니다
- 뜻이 비슷한 여러 개가 있으면, 사용자가 말한 **행위**에 가장 가까운 것을 고르세요
  "돈 보내다" → 이체하는 화면 (이체 내역을 보는 화면이 아닙니다)
  "얼마 나갔나" → 내역을 보는 화면 (이체하는 화면이 아닙니다)`;

export const ASSIST_SCHEMA = {
  type: "object",
  properties: {
    pick: { type: "integer" },
    why: { type: "string" },
  },
  required: ["pick"],
} as const;

/**
 * 후보를 번호로 준다. id를 그대로 주지 않는 이유는 보강기와 같다 —
 * 토큰이 덜 들고, 무엇보다 <b>모델이 없는 id를 지어낼 여지가 사라진다.</b>
 */
export function buildAssistPrompt(
  query: string,
  candidates: readonly AssistCandidate[],
): string {
  const lines = candidates.map((candidate, index) => {
    const where = candidate.path && candidate.path.length > 0 ? ` (${candidate.path.join(" > ")})` : "";
    const hint = candidate.hint ? ` — ${candidate.hint}` : "";
    return `${index}. ${candidate.label}${where}${hint}`;
  });
  return `사용자가 한 말: "${query}"\n\n후보:\n${lines.join("\n")}`;
}

/**
 * 모델 답을 메뉴 id로. **범위 밖이면 없는 것으로 본다.**
 *
 * <p>`-1`을 낼 수 있게 해 둔 것이 요점이다. 그것이 없으면 모델은 무엇이든 고르고,
 * 답이 없어야 할 질의("날씨 어때")에도 메뉴를 들이밀게 된다.
 */
export function parseAssistResponse(
  raw: unknown,
  candidates: readonly AssistCandidate[],
): { menuId: string | null; why: string } {
  if (typeof raw !== "object" || raw === null) return { menuId: null, why: "응답 없음" };
  const answer = raw as Record<string, unknown>;
  const pick = typeof answer["pick"] === "number" ? answer["pick"] : -1;
  const why = typeof answer["why"] === "string" ? answer["why"] : "";

  const chosen = candidates[pick];
  if (pick < 0 || !chosen) return { menuId: null, why: why || "맞는 것 없음" };
  return { menuId: chosen.menuId, why };
}

/** 한 번의 폴백. 호출자는 온디바이스가 실패했을 때만 부른다. */
export async function assist(
  gemini: Gemini,
  query: string,
  candidates: readonly AssistCandidate[],
): Promise<{ menuId: string | null; why: string }> {
  if (candidates.length === 0) return { menuId: null, why: "후보 없음" };
  const raw = await gemini.json(
    ASSIST_SYSTEM,
    buildAssistPrompt(query, candidates),
    ASSIST_SCHEMA,
  );
  return parseAssistResponse(raw, candidates);
}
