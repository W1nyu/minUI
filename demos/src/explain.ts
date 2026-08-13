import type { MenuCatalog, MenuId } from "@minui/core";

/**
 * 브라우저에서 `/api/explain`을 부른다.
 *
 * <p>`assist.ts`와 같은 구조다 — 키는 서버에만 있고 브라우저는 <b>메뉴 이름과 경로만</b>
 * 보낸다. 이 파일이 번들에 들어가도 새어 나갈 것이 없다.
 *
 * <p>`menuId`를 그대로 보내지 않고 라벨로 바꿔 보내는 이유: 서버가 사이트별 카탈로그를
 * 들고 있지 않아도 되고, id는 모델에게 아무 뜻이 없어 토큰만 축낸다.
 */
export function makeExplain(catalog: MenuCatalog) {
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));

  return async (menuId: MenuId): Promise<string | null> => {
    const menu = byId.get(menuId);
    if (!menu) return null;

    const response = await fetch("/api/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: menu.label,
        ...(menu.path ? { path: menu.path } : {}),
      }),
    });
    if (!response.ok) return null;

    const answer = (await response.json()) as { hint: string | null };
    return answer.hint ?? null;
  };
}
