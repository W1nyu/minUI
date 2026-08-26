import type { MenuCatalog, MenuId } from "@minui/core";

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

/**
 * Remote assistance is for menu discovery, not financial personal data.
 *
 * <p>The local search path still receives every query.  This guard only
 * decides whether a query may cross the optional `/api/assist` boundary.
 * Numbers, transaction wording, account wording, and ordinary Korean
 * addressee forms are deliberately handled locally instead.
 */
export function isSafeAssistQuery(query: string): boolean {
  const normalized = query.normalize("NFC").trim();
  if (normalized.length === 0) return false;

  return !(
    /[0-9０-９]/.test(normalized) ||
    /송금|입금|출금|보내|받아|계좌|잔액|금액/.test(normalized) ||
    /(?<!자동)이체/.test(normalized) ||
    /[가-힣]{2,}(?:에게|한테|께|님)/.test(normalized)
  );
}

/**
 * 도우미가 있는 곳. 없으면 도우미 자체를 만들지 않는다.
 *
 * <p>배포는 GitHub Pages(정적)라 같은 오리진에 `/api/assist`가 없다. 별도로 띄운
 * 중계기(`services/assist-worker`) 주소를 `VITE_ASSIST_URL`로 준다.
 *
 * <p>로컬 dev에는 vite 플러그인이 `/api/assist`를 열어 두므로 그 상대 경로가 기본값이다.
 */
export function assistEndpoint(): string | undefined {
  const configured = import.meta.env.VITE_ASSIST_URL;
  if (configured && configured.length > 0) return configured;
  // 정적 배포에는 이 주소가 없다. 있는 척하지 않는다.
  return import.meta.env.PROD ? undefined : "/api/assist";
}

/**
 * @param endpoint 도우미 주소. **없으면 이 함수를 부르지 말 것** —
 *   호출자가 `assist` prop 자체를 넘기지 않아야 화면에 "묻는 중" 상태가 안 생긴다.
 */
export function makeAssist(catalog: MenuCatalog, endpoint: string) {
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));

  return async (query: string, pool: MenuId[]): Promise<MenuId | null> => {
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

      const picked = (await response.json()) as { menuId: MenuId | null };
      return picked.menuId ?? null;
    } catch {
      /*
       * 중계기가 죽었거나 못 닿았다. 되묻기 화면이 이미 떠 있으므로 아무것도 하지 않는다 —
       * 여기서 오류를 보여 주면 사용자는 자기가 뭘 잘못한 줄 안다.
       */
      return null;
    }
  };
}
