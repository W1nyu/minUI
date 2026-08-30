import { aiEndpoint, askRelay } from "./endpoints.js";

/**
 * 확인 문장의 **뼈대**를 중계기에서 받아 값을 채운다 (AI-4).
 *
 * <p>이 파일이 이 저장소의 AI 설계를 한 화면으로 보여 준다.
 * <b>모델은 말투를 정하고, 값은 절대 못 만진다.</b>
 *
 * <p>보내는 것에 값이 하나도 없다 — 위험도와 걸린 점검의 <b>종류 이름</b>뿐이다.
 * 수취인도 금액도 계좌번호도 요청 본문에 담기지 않는다. 거르는 것이 아니라
 * <b>담을 곳이 없다</b>는 것이 요점이다: 거를 것이 있으면 언젠가 새는 날이 온다.
 *
 * <p>실패하면 `null`이고, 화면은 쓰던 고정 문구를 그대로 쓴다. 중계기 주소가 없으면
 * 호출 자체가 만들어지지 않아 프로덕션 번들에서 이 가지가 사라진다.
 */

/** 뼈대에서 앱이 채우는 자리. `services/enricher/src/confirm.ts`와 **같아야 한다.** */
const PAYEE_SLOT = "{받는분}";
const AMOUNT_SLOT = "{금액}";

export interface ConfirmRequest {
  riskLevel: "low" | "medium" | "high";
  /** 안심 점검의 종류 이름들 (`SafetyKind`). **값이 아니라 종류다.** */
  concerns: readonly string[];
}

export interface ConfirmSentence {
  text: string;
  /** 어느 모델이 썼는지. 화면의 출처 배지에 실린다 (AI-8). */
  model?: string | undefined;
}

/**
 * 확인 문장을 만든다. 실패하면 `null`.
 *
 * @param values 앱이 채울 값. **여기가 값이 들어오는 유일한 자리다** — 화면마다 따로
 *   치환하면 한 화면이 빠뜨리고 모델 문장을 그대로 띄우는 날이 온다.
 */
export function makeConfirmSentence() {
  const endpoint = aiEndpoint("confirm");
  if (!endpoint) return undefined;

  return async (
    request: ConfirmRequest,
    values: { payee: string; amount: string },
  ): Promise<ConfirmSentence | null> => {
    const answer = await askRelay(
      endpoint,
      { riskLevel: request.riskLevel, concerns: [...request.concerns] },
      (payload) => {
        const template = payload["template"];
        if (typeof template !== "string" || template.length === 0) return null;
        const model = payload["model"];
        return {
          template,
          ...(typeof model === "string" ? { model } : {}),
        };
      },
    );
    if (!answer) return null;

    /*
     * **자리가 정확히 하나씩 있는지 여기서 한 번 더 본다.**
     *
     * 서버가 이미 `parseConfirmResponse`로 걸렀지만, 화면에 값을 채우는 것은 이쪽이다.
     * 채우는 쪽이 스스로 확인하지 않으면, 서버 검증이 바뀌는 날 조용히 `{금액}`이
     * 그대로 뜬 확인 화면이 나간다. 값을 다루는 자리는 두 번 본다.
     */
    if (
      occurrences(answer.template, PAYEE_SLOT) !== 1 ||
      occurrences(answer.template, AMOUNT_SLOT) !== 1
    ) {
      return null;
    }

    const text = answer.template
      .split(PAYEE_SLOT)
      .join(values.payee)
      .split(AMOUNT_SLOT)
      .join(values.amount);

    return { text, ...(answer.model ? { model: answer.model } : {}) };
  };
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
