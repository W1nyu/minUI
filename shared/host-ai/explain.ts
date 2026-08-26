import type { MenuCatalog, MenuId } from "@minui/core";
import cache from "./explain-cache.json";

/**
 * "이게 무슨 뜻이에요?" — **미리 구워 둔 답을 먼저 보고, 없으면 서버에 묻는다.**
 *
 * <p>배포는 GitHub Pages다. 정적 호스팅이라 `/api/explain` 중계가 없다. 그래서 답을
 * 빌드 타임에 받아 두고(`tools/src/build-explain-cache.ts`) 여기서 조회만 한다.
 * 결과적으로 <b>배포된 번들에도 서버에도 API 키가 존재하지 않는다</b> (절대 보호선 규칙 7).
 *
 * <p>런타임 호출을 지우지 않은 이유: 로컬 `pnpm --filter demos dev`에는 `/api/explain`이
 * 살아 있고, 캐시에 없는 메뉴(Studio로 방금 얹은 사이트가 그렇다)는 그쪽이 답한다.
 * <b>한 번도 안 도는 예비 경로는 예비가 아니다</b>(`stt.ts`의 원칙)를 지키려면 개발 중에
 * 계속 도는 편이 낫다.
 *
 * <p>키를 `menuId`가 아니라 `label|path`로 잡은 것은 의도다. 사이트가 개편돼 id가 바뀌어도
 * 이름이 같으면 뜻풀이는 그대로 맞고, 서버로 보내던 것과도 같은 값이라 두 경로가 어긋나지
 * 않는다.
 *
 * <p>돌려주는 값의 뜻은 화면 계약을 그대로 따른다 — `null`은 "물어봤는데 모른다"이고
 * `AllMenuSheet`가 그때 버튼을 되돌리지 않는다. 빈 문자열로 구워진 것(모델이 모른다고
 * 한 것)도 `null`로 접는다.
 */

const CACHE = cache as Record<string, string>;

/** 캐시 키. `tools/src/build-explain-cache.ts`의 `key()`와 **같은 규칙이어야 한다.** */
export function explainKey(label: string, path?: readonly string[]): string {
  return path && path.length > 0 ? `${label}|${path.join(">")}` : label;
}

export function makeExplain(catalog: MenuCatalog) {
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));

  return async (menuId: MenuId): Promise<string | null> => {
    const menu = byId.get(menuId);
    if (!menu) return null;

    const cached = CACHE[explainKey(menu.label, menu.path)];
    if (cached !== undefined) return cached.length > 0 ? cached : null;

    try {
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
    } catch {
      // 정적 배포에는 이 주소가 없다. 못 물었다는 것과 물었는데 모른다는 것을
      // 화면에서 굳이 가르지 않는다 — 둘 다 "뜻을 알 수 없었어요"다.
      return null;
    }
  };
}
