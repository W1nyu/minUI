import type { LlmClient } from "./llm.js";

/**
 * 확인 문장의 **뼈대**를 모델이 쓴다 (AI-4).
 *
 * <p>이 파일이 이 저장소의 AI 설계를 한 화면으로 보여 주는 자리다.
 * <b>모델은 말투를 정하고, 값은 절대 못 만진다.</b>
 *
 * <pre>
 *   모델이 내는 것   "{받는분}님께 {금액}을 보냅니다. 보내고 나면 되돌리기 어려워요."
 *   앱이 채우는 것   받는분 = 화면이 고른 수취인, 금액 = 사용자가 입력한 값
 * </pre>
 *
 * <p>그래서 <b>모델이 금액을 틀리게 말하는 일이 구조적으로 불가능하다.</b> 자리를
 * 지정할 수는 있어도 값을 쓸 수는 없고, 숫자가 섞여 오면 뼈대 자체가 버려진다.
 * 고위험 확인 문구를 모델에게 통째로 맡기면 "3만 원"이 "30만 원"으로 나오는 날이 오고,
 * 그 한 번이 이 기능이 준 모든 이득을 지운다.
 *
 * <p>실패하면 앱이 쓰던 고정 문구가 그대로 답이 된다 — `assist`가 없을 때 되묻기가
 * 그대로 답이 되는 것과 같다. <b>없는 것이 고장으로 보이지 않는다.</b>
 */

/** 뼈대에서 앱이 채우는 자리. 이 둘만 허용한다. */
export const PAYEE_SLOT = "{받는분}";
export const AMOUNT_SLOT = "{금액}";

/** 두 문장 상한. 확인 문구가 길면 사람은 읽는 대신 아래 버튼을 찾는다. */
export const MAX_TEMPLATE_CHARS = 90;

export const CONFIRM_SYSTEM = `고령 사용자가 돈을 보내기 직전에 읽을 **확인 문장의 틀**을 만듭니다.

- 반드시 ${PAYEE_SLOT}와 ${AMOUNT_SLOT}를 **각각 한 번씩** 넣으세요. 앱이 그 자리를 채웁니다
- **숫자를 절대 쓰지 마세요.** 금액도 계좌번호도 여러분이 쓰는 것이 아닙니다
- 두 문장을 넘기지 마세요. 전체 60자 안팎입니다
- 겁을 주지 마세요. 사실을 말하고 판단은 사용자에게 남깁니다
- 존댓말을 쓰고, 어려운 금융 용어를 쓰지 마세요

좋음: "${PAYEE_SLOT}님께 ${AMOUNT_SLOT}을 보냅니다. 맞는지 한 번만 더 봐 주세요."
나쁨: "3만원을 보냅니다" (숫자를 직접 씀)
나쁨: "사기일 수 있으니 조심하세요" (겁을 줌, 근거 없음)
나쁨: "이체를 실행합니다" (어려운 말)`;

export const CONFIRM_SCHEMA = {
  type: "object",
  properties: { template: { type: "string" } },
  required: ["template"],
} as const;

export interface ConfirmContext {
  /** 위험도. 문장의 무게를 정하는 데만 쓴다 — 값은 넘기지 않는다. */
  riskLevel: "low" | "medium" | "high";
  /** 안심 점검에서 걸린 것들의 종류. **이름뿐이고 값은 없다.** */
  concerns?: readonly string[];
}

/**
 * **보내는 것에 값이 하나도 없다.** 수취인 이름도 금액도 계좌번호도 넘기지 않는다.
 *
 * <p>이것이 §11.1과 `shared/host-ai/assist.ts`의 차단 규칙을 지키는 방법이다 —
 * 걸러 내는 것이 아니라 <b>애초에 담지 않는다.</b> 거를 것이 있으면 언젠가 새는 날이 온다.
 */
export function buildConfirmPrompt(context: ConfirmContext): string {
  const concerns =
    context.concerns && context.concerns.length > 0
      ? `\n걸린 점검: ${context.concerns.join(", ")}`
      : "";
  return `위험도: ${context.riskLevel}${concerns}`;
}

/**
 * 모델 답을 확인 문구 뼈대로. **넷을 본다.**
 *
 * <ol>
 *   <li>두 자리가 <b>각각 정확히 한 번</b> 있는가 — 없으면 값을 못 채우고, 두 번이면
 *       금액이 두 번 나온다
 *   <li>자리를 뺀 나머지에 <b>숫자가 없는가</b>
 *   <li>길이가 상한 안인가
 *   <li>자리 표시를 흉내 낸 다른 중괄호가 없는가 — 있으면 화면에 `{` 가 그대로 뜬다
 * </ol>
 */
export function parseConfirmResponse(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const template = (raw as Record<string, unknown>)["template"];
  if (typeof template !== "string") return null;

  const text = template.trim();
  if (text.length === 0 || text.length > MAX_TEMPLATE_CHARS) return null;

  if (occurrences(text, PAYEE_SLOT) !== 1) return null;
  if (occurrences(text, AMOUNT_SLOT) !== 1) return null;

  const withoutSlots = text.split(PAYEE_SLOT).join("").split(AMOUNT_SLOT).join("");
  if (/[0-9０-９]/u.test(withoutSlots)) return null;
  if (/[{}]/u.test(withoutSlots)) return null;

  return text;
}

/**
 * 뼈대에 값을 넣는다. **여기가 값이 들어오는 유일한 자리다.**
 *
 * <p>호스트가 이 함수를 쓰는 것이 요점이다 — 화면마다 따로 치환하면 한 화면이
 * 빠뜨리고 모델 문장을 그대로 띄우는 날이 온다.
 */
export function fillConfirmTemplate(
  template: string,
  values: { payee: string; amount: string },
): string {
  return template.split(PAYEE_SLOT).join(values.payee).split(AMOUNT_SLOT).join(values.amount);
}

export async function confirmSentence(
  llm: LlmClient,
  context: ConfirmContext,
): Promise<string | null> {
  const raw = await llm.json(CONFIRM_SYSTEM, buildConfirmPrompt(context), CONFIRM_SCHEMA);
  return parseConfirmResponse(raw);
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
