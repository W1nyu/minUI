import type { LlmClient } from "./llm.js";

/**
 * 잘못 들린 말을 **질의로** 고쳐 쓴다 (AI-6).
 *
 * <p><b>`assist`와 무엇이 다른가.</b> `assist`는 후보 중에서 <b>목적지를 고른다</b>.
 * 이것은 목적지를 고르지 않는다 — <b>사용자가 한 말을 고쳐 쓸 뿐</b>이고, 고쳐진 말은
 * 평소의 로컬 검색 파이프라인을 그대로 지난다.
 *
 * <p>그 차이가 중요한 이유가 셋이다.
 *
 * <ol>
 *   <li><b>모델이 화면을 정하지 못한다.</b> 고쳐진 말로 무엇이 열릴지는 여전히
 *       `resolveVoiceAction`이 정하고, `riskLevel: high`는 그대로 막힌다 (§9.3)
 *   <li><b>개인 동의어 학습이 살아 있다.</b> 모델이 메뉴를 골라 버리면 M7이 배운 말이
 *       끼어들 자리가 없다. 질의를 고치면 배운 말·자모 보정·n-gram이 순서대로 다 돈다
 *   <li><b>고친 말을 사용자에게 보여 줄 수 있다.</b> "이렇게 들으신 것 같아요"는
 *       확인할 수 있는 말이지만, 모델이 고른 메뉴는 왜 그것인지 알 수 없다
 * </ol>
 *
 * <p>§9.2가 적어 둔 저품질 STT 흡수 장치의 마지막 겹이다. 자모 보정이 <b>글자 모양</b>으로
 * 못 메운 것을 여기서 <b>말의 뜻</b>으로 메운다 — "자동이체 안 나가게"가 "자동이 체안
 * 나가게"로 들렸을 때 자모 거리로는 이미 붙지만, "가동 이체"처럼 다른 낱말로 들리면
 * 글자 모양이 도와주지 못한다.
 */

/** 고쳐 쓴 말의 상한. 원래 발화보다 길어지면 그것은 교정이 아니라 창작이다. */
export const MAX_CORRECTED_CHARS = 30;

export interface CorrectCandidate {
  label: string;
}

export const CORRECT_SYSTEM = `아래 문장은 고령 사용자의 **음성 인식 결과**라 잘못 들렸을 수 있습니다.
금융 앱의 메뉴 이름 목록을 참고해, 사용자가 실제로 말했을 법한 말로 고쳐 쓰세요.

- **말을 고쳐 쓰기만 하세요.** 어느 메뉴인지 고르지 마세요
- 메뉴 이름을 그대로 베끼지 마세요. 사용자가 쓸 법한 **구어체**로 쓰세요
- 15자 안팎. 원래 문장보다 길어지면 안 됩니다
- 숫자를 쓰지 마세요
- **고칠 것이 없거나 무슨 말인지 모르겠으면 빈 문자열**로 두세요. 억지로 고치지 마세요

좋음: "가동 이체 안 나가게" → "자동이체 안 나가게"
좋음: "돈 부치는 데 어디야" → "돈 보내는 곳"
나쁨: "가동 이체 안 나가게" → "자동이체 해지" (메뉴 이름을 베낌)
나쁨: "날씨 어때" → "날짜 조회" (금융과 무관한 말을 억지로 고침 — 빈 문자열이 맞음)`;

export const CORRECT_SCHEMA = {
  type: "object",
  properties: { corrected: { type: "string" } },
  required: ["corrected"],
} as const;

export function buildCorrectPrompt(
  heard: string,
  candidates: readonly CorrectCandidate[],
): string {
  const menus = candidates.map((candidate) => `- ${candidate.label}`).join("\n");
  return `들린 말: "${heard}"\n\n이 앱에 있는 메뉴 (참고용):\n${menus}`;
}

/**
 * 모델 답을 고쳐진 질의로. **같은 말이면 `null`이다.**
 *
 * <p>같은 말을 돌려받았을 때 그것을 "고쳤다"고 화면에 띄우면, 사용자는 아무것도 안 바뀐
 * 문장 옆의 "이렇게 들으신 것 같아요"를 보고 화면이 고장 났다고 읽는다.
 */
export function parseCorrectResponse(raw: unknown, heard: string): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const corrected = (raw as Record<string, unknown>)["corrected"];
  if (typeof corrected !== "string") return null;

  const text = corrected.trim();
  if (text.length === 0 || text.length > MAX_CORRECTED_CHARS) return null;
  // 교정 결과에 숫자가 있으면 버린다 — 금액을 지어내는 경로를 만들지 않는다.
  if (/[0-9０-９]/u.test(text)) return null;

  // 공백만 다른 것도 같은 말로 본다.
  const same = (value: string) => value.replace(/\s+/g, "");
  if (same(text) === same(heard)) return null;

  return text;
}

export async function correctQuery(
  llm: LlmClient,
  heard: string,
  candidates: readonly CorrectCandidate[],
): Promise<string | null> {
  if (heard.trim().length === 0) return null;
  const raw = await llm.json(
    CORRECT_SYSTEM,
    buildCorrectPrompt(heard, candidates),
    CORRECT_SCHEMA,
  );
  return parseCorrectResponse(raw, heard);
}
