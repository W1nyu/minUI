import type { MenuCatalog, MenuId } from "@minui/core";
import { validateProposal } from "@minui/core";
import { aiEndpoint } from "./endpoints.js";

/**
 * 브라우저에서 `/api/assist`를 부른다.
 *
 * <p>여기에 API 키가 없는 것이 요점이다. 키는 서버에만 있고 브라우저는 질의와 후보만 보낸다
 * (`assistRoute.ts` 참고). 이 파일이 번들에 들어가도 새어 나갈 것이 없다.
 *
 * <p>후보는 엔진이 관련도 순으로 추려 준다(`engine.candidates`). 서버가 사이트별
 * 카탈로그를 들고 있지 않아도 되고, 900개를 통째로 보내지 않아 토큰도 아낀다 —
 * 실측에서 20개를 보여 줬을 때 되묻던 질의의 64%가 풀렸다.
 */

/** 도우미에게 보여 줄 후보 수. 많으면 정확하지만 토큰이 는다. */
const CANDIDATE_COUNT = 20;

/*
 * 개인정보 문은 `privacy.ts`로 옮겼다 (AI-2).
 *
 * 여기 두면 이 파일을 부르는 경로 하나만 지킨다. 중계기가 넷으로 늘면서 **서버도**
 * 같은 판정을 봐야 했는데, 이 파일에는 `import.meta.env`가 있어 Worker에서 못 읽는다.
 * 기존 import를 깨지 않게 이름은 그대로 다시 내보낸다.
 */
export { isSafeAssistQuery, isSafeMenuLabel } from "./privacy.js";
import { isSafeAssistQuery } from "./privacy.js";

/**
 * 도우미가 있는 곳. 없으면 도우미 자체를 만들지 않는다.
 *
 * <p>배포는 GitHub Pages(정적)라 같은 오리진에 `/api/assist`가 없다. 별도로 띄운
 * 중계기(`services/assist-worker`) 주소를 `VITE_ASSIST_URL`로 준다.
 *
 * <p>로컬 dev에는 vite 플러그인이 `/api/assist`를 열어 두므로 그 상대 경로가 기본값이다.
 */
export function assistEndpoint(): string | undefined {
  // 네 경로가 한 주소에서 유도된다 (`endpoints.ts`). 여기서 따로 만들지 않는다.
  return aiEndpoint("assist");
}

/**
 * 도우미가 낸 것 하나 (AI-9).
 *
 * <p>전에는 `menuId`만 돌려줬다. 그러면 화면이 <b>모델이 왜 그것을 골랐는지</b>도,
 * <b>어느 모델이었는지</b>도 말할 수 없다. 돈이 오가는 앱에서 AI가 내민 후보를
 * 다른 검색 결과와 똑같이 그리면, 사용자는 그것이 모델의 추측인 줄 모른다.
 */
export interface AssistAnswer {
  menuId: MenuId;
  /** 모델이 쓴 한 줄. **검증을 지난 것만 온다** — 길이·숫자 검사에 걸리면 없다. */
  why?: string | undefined;
  model?: string | undefined;
  /** 검증에서 버린 것이 있으면 그 이유. 화면이 "버렸다"고 말할 수 있게. */
  dropped?: string | undefined;
}

/**
 * @param endpoint 도우미 주소. **없으면 이 함수를 부르지 말 것** —
 *   호출자가 `assist` prop 자체를 넘기지 않아야 화면에 "묻는 중" 상태가 안 생긴다.
 */
export function makeAssist(catalog: MenuCatalog, endpoint: string) {
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));

  return async (query: string, pool: MenuId[]): Promise<AssistAnswer | null> => {
    // 금융 개인정보일 수 있는 발화는 외부 모델 대신 항상 로컬 검색 결과로 끝낸다.
    if (!isSafeAssistQuery(query)) return null;

    const candidates = pool.slice(0, CANDIDATE_COUNT).flatMap((menuId) => {
      const menu = byId.get(menuId);
      if (!menu) return [];
      return [
        {
          menuId: menu.id,
          label: menu.label,
          ...(menu.path ? { path: menu.path } : {}),
          ...(menu.hint ? { hint: menu.hint } : {}),
        },
      ];
    });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, candidates }),
      });
      if (!response.ok) return null;

      const picked = (await response.json()) as {
        menuId: MenuId | null;
        why?: string;
        model?: string;
      };
      if (!picked.menuId) return null;

      /*
       * **모델이 쓴 글을 그대로 화면에 올리지 않는다** (AI-9).
       *
       * `validateProposal`이 이미 있는 검사를 여기서 쓴다 — 카탈로그에 없는 메뉴는
       * 버려지고, 모델이 쓴 한 줄은 길이와 숫자 검사를 지난다. 통과 못 한 이유는
       * 지우지 않고 `dropped`로 남긴다: 화면이 "AI가 낸 것 중 무엇을 버렸는지"를
       * 말할 수 있어야, 검증이 있다는 사실이 사용자에게도 보인다.
       */
      const checked = validateProposal(
        { menuId: picked.menuId, intent: "look", ...(picked.why ? { why: picked.why } : {}) },
        catalog,
      );
      if (!checked.ok) return null;

      const whyDropped =
        picked.why && !checked.proposal.why ? "숫자가 있거나 너무 길어서" : undefined;

      return {
        menuId: checked.proposal.menuId,
        ...(checked.proposal.why ? { why: checked.proposal.why } : {}),
        ...(picked.model ? { model: picked.model } : {}),
        ...(whyDropped ? { dropped: whyDropped } : {}),
      };
    } catch {
      /*
       * 중계기가 죽었거나 못 닿았다. 되묻기 화면이 이미 떠 있으므로 아무것도 하지 않는다 —
       * 여기서 오류를 보여 주면 사용자는 자기가 뭘 잘못한 줄 안다.
       */
      return null;
    }
  };
}
