import { aiEndpoint, askRelay } from "./endpoints.js";
import { isSafeAssistQuery } from "./privacy.js";

/**
 * 못 알아들었을 때 **한 문장으로 되묻는다** (AI-3).
 *
 * <p>지금도 되묻기는 있다 — `buildReprompt`가 후보들의 갈래를 세어 선택지를 만든다.
 * 결정론이고 빠르지만 <b>질문 문장이 없다.</b> 화면에는 갈래 이름 셋이 나열될 뿐이라,
 * 사용자는 자기가 무엇을 잘못 말했는지 모른 채 다시 고른다.
 *
 * <p>모델이 하는 일은 둘뿐이다 — <b>질문 한 줄을 쓰고, 이미 있는 갈래 중 둘을 고른다.</b>
 * 갈래를 만들지 못한다. 우리가 보낸 목록에서 번호로 고르게 했고, 돌아온 것도 그 목록
 * 안에서만 되짚는다. 없는 갈래가 화면에 뜨는 일이 구조적으로 불가능하다.
 *
 * <p>실패하면 `null`이고, 화면은 지금까지의 갈래 되묻기를 그대로 쓴다.
 */

export interface ClarifyBranch {
  label: string;
}

export interface Clarification {
  question: string;
  /** 고른 갈래 둘. **우리가 보낸 목록의 것들이다.** */
  branches: ClarifyBranch[];
  model?: string | undefined;
}

export function makeClarify() {
  const endpoint = aiEndpoint("clarify");
  if (!endpoint) return undefined;

  return async (
    query: string,
    branches: readonly ClarifyBranch[],
  ): Promise<Clarification | null> => {
    // 금융 개인정보일 수 있는 발화는 원격 경계를 넘지 않는다. 로컬 되묻기가 답한다.
    if (!isSafeAssistQuery(query)) return null;
    // 갈래가 둘도 안 되면 물어볼 것이 없다. 한도를 쓰지 않는다.
    if (branches.length < 2) return null;

    const known = new Set(branches.map((branch) => branch.label));

    return askRelay(
      endpoint,
      { query, branches: branches.map((branch) => ({ label: branch.label })) },
      (payload) => {
        const clarification = payload["clarification"];
        if (typeof clarification !== "object" || clarification === null) return null;
        const value = clarification as Record<string, unknown>;

        const question = value["question"];
        if (typeof question !== "string" || question.length === 0) return null;

        const picked = value["branches"];
        if (!Array.isArray(picked) || picked.length !== 2) return null;

        const labels: ClarifyBranch[] = [];
        for (const item of picked) {
          const label = (item as Record<string, unknown> | null)?.["label"];
          /*
           * **우리가 보낸 목록에 있는 것만 받는다.** 서버가 이미 번호로 되짚었지만,
           * 화면에 그리는 것은 이쪽이다. 그리는 쪽이 스스로 확인하지 않으면 서버
           * 검증이 바뀌는 날 없는 갈래가 화면에 뜬다.
           */
          if (typeof label !== "string" || !known.has(label)) return null;
          labels.push({ label });
        }

        const model = payload["model"];
        return {
          question,
          branches: labels,
          ...(typeof model === "string" ? { model } : {}),
        };
      },
    );
  };
}
