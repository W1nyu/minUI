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

export function makeAssist(catalog: MenuCatalog) {
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));

  return async (query: string, pool: MenuId[]): Promise<MenuId | null> => {
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

    const response = await fetch("/api/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, candidates }),
    });
    if (!response.ok) return null;

    const picked = (await response.json()) as { menuId: MenuId | null };
    return picked.menuId ?? null;
  };
}
