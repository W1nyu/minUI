/**
 * 링크에서 **메뉴 식별자**를 뽑는다.
 *
 * <p>이 파일이 따로 있는 이유는 테스트 때문이다. DOM 순회는 브라우저 안에서만 돌지만,
 * "이 링크의 id를 무엇으로 삼을 것인가"는 순수 함수라 브라우저 없이 잴 수 있다.
 * 그리고 이 판단이 수집기의 품질을 거의 전부 결정한다 —
 * <b>id가 안정적이면 사이트가 개편돼도 사람이 붙인 동의어가 살아남는다.</b>
 *
 * <p>다섯 사이트를 손으로 수집하면서 확인한 것은, 코드가 **저마다 다른 자리**에 있다는 것이다.
 * <pre>
 *   KB국민은행   ?page=C016536        쿼리 파라미터
 *   KB증권       ?linkcd=m02010002    쿼리 파라미터 (이름이 다르다)
 *   하나은행     onclick="...102689"  onclick 안의 숫자
 *   신한은행     javascript:void(null) 아무것도 없다 → 라벨 경로
 *   미래에셋     javascript:...        아무것도 없다 → 라벨 경로
 * </pre>
 * 그래서 한 가지 규칙으로는 안 되고, 우선순위를 둔 사다리가 필요하다.
 */

/**
 * 메뉴 코드가 담기는 쿼리 파라미터 이름들. 우선순위 순.
 *
 * <p>실측으로 모았다. 일반적인 이름(`id`, `code`)을 뒤에 두는 이유는, 그것들이 메뉴가 아닌
 * 다른 것(캠페인 id, 추적 코드)을 담고 있을 때가 많기 때문이다.
 */
const CODE_PARAMS = ["page", "linkcd", "menucd", "menuid", "menu_id", "mnuid", "cmd"];

/** 값이 코드로 쓸 만한가. 너무 짧거나 흔한 말이면 id로 삼을 수 없다. */
function usableCode(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 40) return false;
  return /^[\w.-]+$/.test(trimmed);
}

export interface LinkFacts {
  /** `href` 원문. 상대·절대·`javascript:` 무엇이든 그대로. */
  href?: string | undefined;
  /** `onclick` 원문. 하나은행은 여기에만 코드가 있다. */
  onclick?: string | undefined;
  /** 요소의 `id`. 하나은행 `depth1_img_12000`처럼 코드를 담기도 한다. */
  elementId?: string | undefined;
  /** 정리된 라벨 경로 + 자기 라벨. 마지막 수단. */
  path: readonly string[];
  label: string;
}

/**
 * 링크 하나에서 수집 `key`를 만든다. 형식은 `<종류>:<값>`이고
 * `tools/src/build-catalog.ts`의 `toId()`가 그대로 받는다.
 *
 * <p>사다리는 **안정성 순**이다. 위로 갈수록 사이트 개편에 덜 끊어진다.
 * <ol>
 *   <li>쿼리 파라미터 코드 — 문구를 바꿔도 그대로다
 *   <li>onclick 안의 숫자 코드 — 같은 성질
 *   <li>요소 id 안의 숫자 코드
 *   <li>pathname — 페이지가 나뉘어 있는 사이트에서만 쓸모 있다
 *   <li>라벨 경로 — <b>문구가 바뀌면 끊어진다.</b> 그래서 마지막이다
 * </ol>
 */
export function deriveKey(facts: LinkFacts): string {
  const href = (facts.href ?? "").trim();

  // ① 쿼리 파라미터. `?`가 있으면 URL 파서를 쓰지 않고 직접 읽는다 —
  //    상대 경로·javascript: 스킴이 섞여 있어 URL 생성자가 던진다.
  const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  if (query) {
    const params = new Map<string, string>();
    for (const pair of query.split(/[&;]/)) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      params.set(pair.slice(0, eq).toLowerCase(), decodeSafely(pair.slice(eq + 1)));
    }
    for (const name of CODE_PARAMS) {
      const value = params.get(name);
      if (usableCode(value)) return `${name === "page" ? "page" : name}:${value.trim()}`;
    }
  }

  // ② onclick 안의 숫자. 하나은행이 `goMenu('102689')` 꼴이다.
  //    4자리 미만은 인덱스나 좌표일 수 있어 코드로 보지 않는다.
  const fromClick = firstCode(facts.onclick);
  if (fromClick) return `code:${fromClick}`;

  // ③ 요소 id 안의 숫자. `depth1_img_12000`.
  const fromId = firstCode(facts.elementId);
  if (fromId) return `code:${fromId}`;

  // ④ pathname. `javascript:`·해시·빈 경로는 제외한다.
  const pathname = toPathname(href);
  if (pathname && pathname !== "/" && !/^\/?(void|null)/.test(pathname)) {
    return `path:${pathname}`;
  }

  // ⑤ 라벨 경로. 끊어지기 쉽지만 없는 것보다는 낫다.
  return `label:${[...facts.path, facts.label].join("/")}`;
}

/** 4자리 이상 숫자 하나. 그보다 짧으면 코드가 아니라 순번일 가능성이 크다. */
function firstCode(source: string | null | undefined): string | null {
  if (!source) return null;
  const match = source.match(/\d{4,}/);
  return match ? match[0] : null;
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * href에서 경로 부분만. URL 생성자를 쓰지 않는 이유는 상대 경로와 `javascript:`가
 * 섞여 들어오기 때문이다.
 */
function toPathname(href: string): string | null {
  if (!href || href.startsWith("#")) return null;
  if (/^(javascript|mailto|tel):/i.test(href)) return null;

  let rest = href;
  const scheme = rest.match(/^https?:\/\/[^/]+/i);
  if (scheme) rest = rest.slice(scheme[0].length);

  const cut = Math.min(
    ...[rest.indexOf("?"), rest.indexOf("#")].filter((i) => i >= 0).concat([rest.length]),
  );
  const pathname = rest.slice(0, cut);
  return pathname.length > 0 ? pathname : null;
}

/**
 * 수집한 링크가 **같은 사이트 안**을 가리키는가.
 *
 * <p>전체메뉴에는 제휴사·SNS·앱스토어 링크가 섞여 들어온다. 그것들은 메뉴가 아니다.
 * 서브도메인은 허용한다 — KB국민은행의 개인뱅킹이 `obank.kbstar.com`이고
 * 본사이트가 `www.kbstar.com`이다.
 */
export function isSameSite(href: string, host: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (/^(javascript|mailto|tel):/i.test(trimmed)) return true; // 스크립트 링크는 내부다
  if (!/^https?:\/\//i.test(trimmed)) return true; // 상대 경로

  const linkHost = trimmed.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() ?? "";
  const registrable = (value: string) => value.split(".").slice(-2).join(".");
  return registrable(linkHost) === registrable(host.toLowerCase());
}
