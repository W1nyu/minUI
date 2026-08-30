import { checkUrl, parseRobots, robotsAllows, type RobotsRules } from "./guard.js";

/**
 * 메뉴가 아니라 **문서**를 긁는다 — 뜻풀이에 붙일 근거를 모으기 위해서다.
 *
 * <p>`harvest.ts`는 전체메뉴에서 <b>이름</b>을 모은다. 여기서 모으는 것은 <b>본문</b>이다.
 * 쓰임이 다르다. 이름은 검색이 쓰고, 본문은 `/api/explain`이 "왜 그런지"를 댈 때 쓴다.
 * 근거 없이 모델이 쓴 설명은 그럴듯한 문장일 뿐이고, 금융 화면에서 그것은 위험하다.
 *
 * <p><b>문서가 사는 자리는 사이트마다 다르다.</b> 기본값(`.jsp`, 쿼리 뗌)은 하나은행을 재 보고
 * 정해졌고(계획서 §Task 1 결과), KB증권처럼 `/go.able?linkcd=`가 유일한 열쇠인 곳은
 * `extensions`·`keepQuery`로 바꿔 준다.
 *
 * <p>하나은행의 사정은 이랬다.
 * 전체메뉴 링크 652개 중 502개가 거래 화면(`.do`)인데 <b>전부 `?_menuNo=`를 달고 있고</b>,
 * 이 사이트의 robots는 `Disallow: /*?`로 쿼리가 붙은 주소를 통째로 막는다. 남는 것이
 * `/cont/**` 아래의 `.jsp` — 상품 설명과 안내문이다. 우리가 필요한 것도 그것이다.
 *
 * <p>쿼리를 떼고 요청하는 것은 우회가 아니다. 홈에 걸린 링크가
 * `/cont/mall/.../index.jsp?_menuNo=98786`이면 <b>쿼리를 뗀 주소만</b> 후보로 삼고,
 * 그 주소에 대해 robots를 다시 묻는다. 막힌 주소를 다른 이름으로 부르는 것이 아니라
 * <b>허용된 주소만 부르는 것</b>이다. 쿼리를 뗀 주소가 막혀 있으면 그것도 안 받는다.
 */

/** 문서 하나. `text`는 사람이 읽는 본문이고, 인용 검증이 이 문자열을 기준으로 돈다. */
export interface HarvestedDoc {
  /** 쿼리·해시를 뗀 절대 주소. 실제로 요청한 주소와 같다. */
  url: string;
  title: string;
  text: string;
  chars: number;
}

export interface DocsFile {
  source: {
    site: string;
    host: string;
    capturedAt: string;
    note?: string;
  };
  docs: HarvestedDoc[];
}

export interface HarvestDocsOptions {
  /** 시작 주소. 보통 사이트 첫 화면이다. */
  url: string;
  site?: string;
  /** 첫 화면에서 몇 다리 건너까지 따라갈 것인가. 기본 2. */
  maxDepth?: number;
  /** 최대 몇 쪽을 받을 것인가. 남의 서버다 — 기본 300에서 멈춘다. */
  maxPages?: number;
  /** 이보다 짧으면 문서로 치지 않는다. 로그인 벽·빈 껍데기가 여기서 걸린다. */
  minChars?: number;
  /** 요청 사이 간격(ms). 기본 500 — 초당 두 번을 넘지 않는다. */
  delayMs?: number;
  /**
   * 문서로 칠 확장자. 기본은 `.jsp`(하나은행).
   *
   * <p>사이트마다 문서가 사는 자리가 다르다. KB증권은 `/go.able`이 전부다.
   * 확장자를 붙박이로 두면 그 사이트는 수집 자체가 안 된다.
   */
  extensions?: readonly string[];
  /**
   * 쿼리를 남길 것인가. **기본은 떼는 것이다.**
   *
   * <p>떼는 편이 안전하다 — 하나은행 robots가 `Disallow: /*?`로 쿼리 붙은 주소를 통째로
   * 막으므로 뗀 주소만 부르는 것이 그쪽 뜻을 지키는 길이다. 하지만 KB증권은 쿼리가
   * <b>문서를 가리키는 유일한 열쇠</b>라(`?linkcd=`) 떼면 전부 같은 첫 화면이 된다.
   * 켜더라도 robots 판정은 그대로 돈다 — 막힌 주소는 여전히 안 부른다.
   */
  keepQuery?: boolean;
  onProgress?: (stage: string, detail?: string) => void;
}

export interface HarvestDocsResult extends DocsFile {
  diagnostics: {
    /** 후보로 올라온 주소 수. */
    seen: number;
    fetched: number;
    /** 왜 후보에서 뺐는가. 수집이 비면 여기를 본다. */
    skipped: { robots: number; offSite: number; notJsp: number };
    dropped: { tooShort: number; failed: number; duplicate: number };
    elapsedMs: number;
  };
}

/**
 * 남의 서버에 우리가 누구인지 밝힌다. 브라우저인 척하지 않는다 —
 * 이 도구는 사람이 보는 척할 이유가 없고, 차단하고 싶은 쪽은 차단할 수 있어야 한다.
 *
 * <p>ASCII만 쓴다. HTTP 헤더 값은 바이트 문자열이라 한글을 넣으면 요청이 <b>보내지기
 * 전에</b> 터진다.
 */
const USER_AGENT =
  "MinUIDocsBot/0.1 (accessibility demo; collects public guide pages; respects robots.txt)";

// ── 순수 함수들 — 네트워크 없이 확인할 수 있게 밖으로 빼 둔다 ──────────────

/**
 * 링크 하나를 **받아도 되는 후보 주소**로 바꾼다. 아니면 이유를 남기고 물러난다.
 *
 * <p>쿼리와 해시는 여기서 떨어진다. 그 뒤에 robots를 묻기 때문에, 판정은 늘
 * <b>실제로 요청할 주소</b>에 대해 이뤄진다.
 */
export function normalizeDocUrl(
  href: string,
  base: string,
  host: string,
  robots: RobotsRules,
  options: { extensions: readonly string[]; keepQuery: boolean },
): { url: string } | { skip: "offSite" | "notJsp" | "robots" | "bad" } {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return { skip: "bad" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return { skip: "bad" };
  if (url.host !== host) return { skip: "offSite" };

  if (!options.keepQuery) url.search = "";
  url.hash = "";

  const path = url.pathname.toLowerCase();
  if (!options.extensions.some((ext) => path.endsWith(ext))) return { skip: "notJsp" };
  // 판정은 쿼리까지 포함해서 한다 — `Disallow: /*?`는 경로만 봐서는 안 걸린다.
  if (!robotsAllows(robots, `${url.pathname}${url.search}`)) return { skip: "robots" };

  return { url: url.toString() };
}

/** HTML에서 `href` 값을 있는 대로 뽑는다. 아직 아무 판단도 하지 않는다. */
export function findHrefs(html: string): string[] {
  const found: string[] = [];
  const re = /href\s*=\s*["']([^"'#][^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = match[1];
    if (href !== undefined) found.push(href);
  }
  return found;
}

/** 흔한 HTML 실체 참조만 되돌린다. 본문에 실제로 나오는 것들이다. */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    middot: "·",
    hellip: "…",
    ndash: "-",
    mdash: "-",
    ldquo: "“",
    rdquo: "”",
    lsquo: "‘",
    rsquo: "’",
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole);
}

/**
 * 태그를 걷어내 사람이 읽는 줄글로 만든다.
 *
 * <p>블록이 끝나는 자리에 줄바꿈을 넣는 것이 요점이다. 태그만 지우면 제목과 본문이 한 줄로
 * 붙어 <b>문장 경계가 사라진다</b>. 인용은 문장 단위로 뜨므로, 경계가 무너지면 인용도
 * 같이 무너진다.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|dd|dt|td|th|blockquote)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // 메뉴는 아이콘용과 글자용으로 같은 말을 두 번 그린다("상품공시실 상품공시실").
    // 붙어 있는 같은 줄은 하나로 접는다 — 인용할 문장이 아니라 잡음이다.
    .filter((line, index, lines) => line !== lines[index - 1])
    .join("\n");
}

/**
 * `<title>`에서 **가장 구체적인 한 조각**만 남긴다.
 *
 * <p>제목은 대개 빵부스러기고 방향이 두 가지다 — `신용대출 < 대출 < 하나은행`은 앞이
 * 구체적이고, `하나은행 > 대출 > 신용대출`은 뒤가 구체적이다. 방향을 안 보고 한쪽만
 * 집으면 문서마다 "하나은행"이 제목이 되어, 출처를 화면에 보여 줄 때
 * <b>어느 문서인지 알 수 없게 된다.</b>
 */
export function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match || match[1] === undefined) return "";
  const raw = decodeEntities(match[1]).replace(/\s+/g, " ").trim();

  const reversed = raw.includes(">") && !raw.includes("<");
  const parts = raw
    .split(reversed ? /\s*>\s*/ : /\s*[<|:–—]\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.toLowerCase() !== "home");

  return (reversed ? parts[parts.length - 1] : parts[0]) ?? raw;
}

/**
 * 본문이 들어 있을 만한 그릇을 고른다.
 *
 * <p>점수는 <b>글자 수에서 링크 글자 수를 뺀 값</b>이다. 안내문과 메뉴 더미를 가르는 것이
 * 바로 이 차이다 — 메뉴는 글자가 전부 링크 안에 있고, 안내문은 링크 밖에 있다.
 * 그릇 후보가 하나도 없으면 문서 전체를 쓴다.
 */
export function pickContentHtml(html: string): string {
  const candidates: string[] = [];
  const re =
    /<(main|article|div|section)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(content|contents|container|cont_wrap|sub_content|txt_wrap|board)[^"']*["'][^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const tag = match[1];
    if (tag === undefined) continue;
    const block = sliceElement(html, match.index, tag);
    if (block !== null) candidates.push(block);
  }

  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  candidates.push(body);

  let best = body;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const text = htmlToText(candidate).length;
    const linkText = htmlToText(candidate.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi)?.join(" ") ?? "").length;
    const score = text - 2 * linkText;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** 여는 태그 자리에서 짝이 맞는 닫는 태그까지 잘라 낸다. 못 맞추면 물러난다. */
function sliceElement(html: string, from: number, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
  re.lastIndex = from;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(from, re.lastIndex);
    if (re.lastIndex - from > 400_000) return null;
  }
  return null;
}

/** 한 쪽에서 문서 하나를 만든다. */
export function toDoc(url: string, html: string): HarvestedDoc {
  const text = htmlToText(pickContentHtml(html));
  return { url, title: extractTitle(html), text, chars: text.length };
}

// ── 실제로 받아 오는 부분 ────────────────────────────────────────────────

export async function harvestDocs(options: HarvestDocsOptions): Promise<HarvestDocsResult> {
  const started = Date.now();
  const report = options.onProgress ?? (() => {});
  const maxDepth = options.maxDepth ?? 2;
  const maxPages = options.maxPages ?? 300;
  const minChars = options.minChars ?? 600;
  const delayMs = options.delayMs ?? 500;
  const extensions = options.extensions ?? [".jsp"];
  const keepQuery = options.keepQuery ?? false;

  const checked = checkUrl(options.url);
  if (!checked.ok || !checked.url) throw new Error(checked.reason ?? "열 수 없는 주소입니다.");

  const start = new URL(checked.url);
  const host = start.host;
  const site = options.site ?? host.replace(/^www\./, "").split(".")[0] ?? host;

  report("robots", `${start.origin}/robots.txt`);
  const robots = await loadRobots(start.origin);

  const skipped = { robots: 0, offSite: 0, notJsp: 0 };
  const dropped = { tooShort: 0, failed: 0, duplicate: 0 };

  const queued = new Set<string>();
  const queue: { url: string; depth: number }[] = [];
  const docs: HarvestedDoc[] = [];
  const seenText = new Set<string>();

  // 첫 화면은 `.jsp`가 아닐 수 있다(하나은행 홈이 그렇다). 링크를 얻으려고 한 번은 연다.
  const startUrl = `${start.origin}${start.pathname}`;
  if (!robotsAllows(robots, start.pathname)) {
    throw new Error(`robots.txt가 ${start.pathname} 수집을 막고 있습니다.`);
  }
  queue.push({ url: startUrl, depth: 0 });
  queued.add(startUrl);

  let fetched = 0;

  while (queue.length > 0 && fetched < maxPages) {
    const next = queue.shift();
    if (next === undefined) break;

    const html = await fetchHtml(next.url);
    fetched += 1;
    if (html === null) {
      dropped.failed += 1;
      continue;
    }
    await sleep(delayMs);

    if (next.depth < maxDepth) {
      for (const href of findHrefs(html)) {
        const verdict = normalizeDocUrl(href, next.url, host, robots, { extensions, keepQuery });
        if ("skip" in verdict) {
          if (verdict.skip === "robots") skipped.robots += 1;
          else if (verdict.skip === "offSite") skipped.offSite += 1;
          else if (verdict.skip === "notJsp") skipped.notJsp += 1;
          continue;
        }
        if (queued.has(verdict.url)) continue;
        queued.add(verdict.url);
        queue.push({ url: verdict.url, depth: next.depth + 1 });
      }
    }

    // 시작 주소가 문서 모양이 아니면 그것 자체는 담지 않는다 — 링크를 얻으려 연 것이다.
    const startPath = new URL(next.url).pathname.toLowerCase();
    if (!extensions.some((ext) => startPath.endsWith(ext))) continue;

    const doc = toDoc(next.url, html);
    if (doc.chars < minChars) {
      dropped.tooShort += 1;
      continue;
    }
    // 같은 안내문이 여러 주소에 걸려 있다. 앞부분이 같으면 하나만 남긴다.
    const fingerprint = doc.text.slice(0, 400);
    if (seenText.has(fingerprint)) {
      dropped.duplicate += 1;
      continue;
    }
    seenText.add(fingerprint);
    docs.push(doc);
    report("doc", `${docs.length}개째 · ${doc.chars.toLocaleString()}자 · ${doc.title}`);
  }

  return {
    source: {
      site,
      host,
      capturedAt: new Date().toISOString(),
      note:
        `공개 안내문 수집. ${extensions.join("·")}${keepQuery ? " (쿼리 포함)" : " (쿼리 뗌)"}. ` +
        "robots.txt 준수 — 막힌 주소는 요청하지 않음. " +
        `로그인하지 않은 상태에서 ${maxDepth}다리까지.`,
    },
    docs,
    diagnostics: {
      seen: queued.size,
      fetched,
      skipped,
      dropped,
      elapsedMs: Date.now() - started,
    },
  };
}

async function loadRobots(origin: string): Promise<RobotsRules> {
  const response = await fetch(`${origin}/robots.txt`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  // robots가 없으면 제한이 없다는 뜻이다. 못 읽은 것과는 다르다 — 못 읽으면 던진다.
  if (response.status === 404) return { disallow: [], allow: [] };
  if (!response.ok) throw new Error(`robots.txt를 읽지 못했습니다 (${response.status}).`);

  const body = await response.text();
  /*
   * robots.txt 자리에 **오류 페이지**를 주는 곳이 있다. KB증권이 그렇다 — 302로 보내고
   * 200 HTML을 준다. 그것을 robots로 파싱하면 규칙 0개가 나와 결과적으로는 맞지만,
   * 맞는 이유가 우연이다. HTML이면 규칙이 없는 것으로 <b>명시해서</b> 본다.
   */
  if (/<html|<!doctype/i.test(body.slice(0, 200))) return { disallow: [], allow: [] };
  return parseRobots(body);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "follow",
      // 답하지 않는 쪽이 있다. 한 쪽이 수집 전체를 붙잡게 두지 않는다.
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return decodeBody(Buffer.from(await response.arrayBuffer()), type);
  } catch {
    return null;
  }
}

/**
 * 바이트를 글자로 푼다. **UTF-8이라고 단정하지 않는다.**
 *
 * <p>KB증권이 EUC-KR이다. `response.text()`는 UTF-8로 읽어서 본문이 통째로 깨지는데,
 * 깨진 본문은 뜻풀이도 인용도 못 만든다. 그런데 <b>조용히 실패한다</b> — 수집은 성공하고
 * 글자만 쓰레기가 된다. 헤더의 charset을 먼저 보고, 없으면 `<meta charset>`을 본다.
 */
export function decodeBody(bytes: Buffer, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  // meta는 문서 앞머리에 있고, 그 앞머리는 어떤 인코딩이든 ASCII로 읽힌다.
  const fromMeta = /charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 2_000).toString("latin1"))?.[1];
  const charset = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // 모르는 이름이면 UTF-8로 읽는다. 여기서 던지면 한 쪽 때문에 수집 전체가 멈춘다.
    return bytes.toString("utf8");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
