import { aiEndpoint, askRelay } from "./endpoints.js";

/**
 * 안심 점검마다 **지금 무엇을 하면 되는지** 한 줄 (AI-5).
 *
 * <p>`safety.ts`의 문장은 무엇이 걸렸는지를 말한다. 그것을 읽은 사용자에게 남는 물음은
 * "그래서 뭘 어떻게 하라고?"이고, 화면이 거기서 멈추면 경고는 불안만 남기고 끝난다.
 *
 * <p><b>보내는 것에 값이 없다.</b> `SafetyKind` 이름들뿐이다 — 금액도 수취인도 잔액도
 * 담기지 않는다. `confirm.ts`와 같은 이유이고 같은 방법이다: 거르는 것이 아니라 담을
 * 곳이 없다.
 *
 * <p>없으면 `null`이고, 화면은 걸린 것만 보여 준다 — 지금까지와 같다.
 */

export interface SafetyTip {
  kind: string;
  text: string;
}

export interface SafetyTips {
  tips: SafetyTip[];
  model?: string | undefined;
}

export function makeSafetyTips() {
  const endpoint = aiEndpoint("safety");
  if (!endpoint) return undefined;

  return async (kinds: readonly string[]): Promise<SafetyTips | null> => {
    if (kinds.length === 0) return null;
    const wanted = new Set(kinds);

    return askRelay(endpoint, { kinds: [...kinds] }, (payload) => {
      const tips = payload["tips"];
      if (!Array.isArray(tips) || tips.length === 0) return null;

      const kept: SafetyTip[] = [];
      for (const item of tips) {
        const kind = (item as Record<string, unknown> | null)?.["kind"];
        const text = (item as Record<string, unknown> | null)?.["text"];
        /*
         * **묻지 않은 항목은 버린다.** 서버가 이미 걸렀지만 그리는 것은 이쪽이다.
         * 그리는 쪽이 스스로 확인하지 않으면, 서버 검증이 바뀌는 날 화면에 없는 점검의
         * 조언이 뜬다.
         */
        if (typeof kind !== "string" || !wanted.has(kind)) continue;
        if (typeof text !== "string" || text.length === 0) continue;
        kept.push({ kind, text });
      }
      if (kept.length === 0) return null;

      const model = payload["model"];
      return { tips: kept, ...(typeof model === "string" ? { model } : {}) };
    });
  };
}
