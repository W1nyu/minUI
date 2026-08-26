/**
 * 주소에서 **배포 기준 경로**를 떼고 붙인다.
 *
 * <p>로컬에서는 데모가 `/`에 있지만 GitHub Pages에서는 `/minUI/`에 있다. 그래서
 * `window.location.pathname`을 그대로 슬러그로 쓰던 코드가 Pages에서는
 * `minUI/shinhan`을 읽어 아무 사이트도 못 찾는다.
 *
 * <p>기준 경로는 vite가 `base`로 넣어 주는 `import.meta.env.BASE_URL`이고
 * **항상 `/`로 끝난다.** 로컬은 `"/"`, Pages는 `"/minUI/"`.
 *
 * <p>이 파일이 따로 있는 이유는 두 곳(읽기·쓰기)에서 같은 규칙을 써야 하기 때문이다.
 * 한쪽만 고치면 주소창은 맞는데 새로고침하면 다른 사이트가 뜨는 식으로 어긋난다.
 */

const BASE = import.meta.env.BASE_URL;

/** 지금 주소가 가리키는 라우트. 기준 경로와 앞뒤 슬래시를 뗀 알맹이다. */
export function currentRoute(): string {
  const path = window.location.pathname;
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : path.replace(/^\//, "");
  return rest.replace(/\/$/, "");
}

/** 라우트 이름을 실제 주소로 바꾼다. `history.replaceState`에 넘길 값이다. */
export function routeHref(route: string): string {
  return `${BASE}${route}`;
}
