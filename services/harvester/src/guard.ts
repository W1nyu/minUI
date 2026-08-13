/**
 * 남의 서버에 요청을 보내기 전에 확인할 것들.
 *
 * <p>이 수집기는 <b>사용자가 준 URL로 서버가 접속하는</b> 구조다. 그래서 두 가지가 필요하다.
 * <ol>
 *   <li><b>사설망 보호(SSRF)</b> — `http://169.254.169.254`나 `http://localhost:5432`를
 *       넣으면 서버가 자기 내부망을 대신 긁어다 준다. 웹서비스로 띄우는 순간 이건 구멍이다
 *   <li><b>robots.txt</b> — 남의 사이트를 읽는 도구라면 그쪽이 밝힌 뜻을 지켜야 한다
 * </ol>
 *
 * <p>둘 다 순수 함수로 두어 브라우저 없이 테스트한다. 안전 규칙은 특히 그래야 한다 —
 * "돌려 보니 되더라"로는 뚫린 곳을 못 찾는다.
 */

export interface UrlCheck {
  ok: boolean;
  /** 막은 이유. 사용자에게 그대로 보여 준다. */
  reason?: string;
  url?: string;
}

/** 사설·예약 대역. 이름이 아니라 주소로 들어오는 경우를 막는다. */
const PRIVATE_V4 = [
  /^127\./, // 루프백
  /^10\./, // 사설 A
  /^192\.168\./, // 사설 C
  /^172\.(1[6-9]|2\d|3[01])\./, // 사설 B
  /^169\.254\./, // 링크로컬 — 클라우드 메타데이터가 여기 있다
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 통신사 CGNAT
];

/** 이름으로 내부를 가리키는 것들. */
const PRIVATE_NAMES = /^(localhost|.*\.local|.*\.internal|.*\.localdomain)$/i;

/**
 * 수집해도 되는 주소인가.
 *
 * <p>IP 주소로 들어오는 경우만 막는다. 도메인 이름이 사설 IP로 풀리는
 * (DNS 리바인딩) 경우까지 막으려면 실제로 풀어 봐야 하는데, 그것은 네트워크가 필요해
 * 여기서 하지 않는다. **웹서비스로 띄울 때는 나가는 요청 자체를 프록시로 한 번 더 막아야 한다.**
 * 그 사실을 여기 적어 둔다 — 이 함수만으로 안전하다고 믿으면 안 된다.
 */
export function checkUrl(input: string): UrlCheck {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "주소가 비어 있습니다." };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "주소 형식이 아닙니다." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `${url.protocol} 주소는 열지 않습니다.` };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (PRIVATE_NAMES.test(host)) {
    return { ok: false, reason: "내부 주소는 열지 않습니다." };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_V4.some((re) => re.test(host))) {
    return { ok: false, reason: "사설망 주소는 열지 않습니다." };
  }
  // IPv6 루프백·유니크로컬
  if (host === "::1" || /^f[cd][0-9a-f]{2}:/i.test(host)) {
    return { ok: false, reason: "사설망 주소는 열지 않습니다." };
  }

  return { ok: true, url: url.toString() };
}

// ── robots.txt ───────────────────────────────────────────────────────────

export interface RobotsRules {
  /** 우리에게 적용되는 Disallow 경로들. */
  disallow: string[];
  /** Allow가 더 구체적이면 Disallow를 이긴다. */
  allow: string[];
}

/**
 * `robots.txt`를 우리에게 해당하는 부분만 읽는다.
 *
 * <p>`User-agent: *` 블록만 본다. 전용 이름을 만들어 그 규칙을 피해 가는 것은
 * robots를 지키는 시늉일 뿐이다.
 */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [] };
  let applies = false;

  for (const line of text.split(/\r?\n/)) {
    const stripped = line.replace(/#.*$/, "").trim();
    if (stripped.length === 0) continue;

    const colon = stripped.indexOf(":");
    if (colon < 0) continue;
    const field = stripped.slice(0, colon).trim().toLowerCase();
    const value = stripped.slice(colon + 1).trim();

    if (field === "user-agent") {
      applies = value === "*";
      continue;
    }
    if (!applies) continue;
    if (field === "disallow" && value.length > 0) rules.disallow.push(value);
    if (field === "allow" && value.length > 0) rules.allow.push(value);
  }

  return rules;
}

/** 이 경로를 읽어도 되는가. 더 긴(구체적인) 규칙이 이긴다 — 표준 관행이다. */
export function robotsAllows(rules: RobotsRules, pathname: string): boolean {
  const match = (patterns: string[]) =>
    patterns
      .filter((pattern) => matchesRobotsPath(pattern, pathname))
      .reduce((longest, pattern) => Math.max(longest, pattern.length), -1);

  const denied = match(rules.disallow);
  const allowed = match(rules.allow);

  if (denied < 0) return true;
  return allowed >= denied;
}

/** robots의 `*`와 `$`만 지원한다. 그 밖의 문자는 그대로 비교한다. */
function matchesRobotsPath(pattern: string, pathname: string): boolean {
  if (pattern === "/") return true;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$$/, "$");
  return new RegExp(`^${escaped}`).test(pathname);
}
