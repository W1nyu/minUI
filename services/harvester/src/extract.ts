/**
 * 페이지 안에서 도는 메뉴 추출기.
 *
 * <p>이 파일의 함수들은 <b>문자열로 직렬화되어 브라우저로 넘어간다.</b> 바깥 스코프의 무엇도
 * 참조할 수 없고 import도 쓸 수 없다. 필요한 것은 전부 안에 들어 있어야 한다.
 *
 * <p>돌려주는 것은 **가공하지 않은 사실**뿐이다 — label·href·onclick·경로.
 * id를 무엇으로 삼을지, 어떤 라벨을 버릴지는 Node 쪽에서 정한다(`keys.ts`, `build-catalog.ts`).
 * 판단을 브라우저 밖으로 빼야 테스트할 수 있다.
 */

/** 페이지에서 건져 온 링크 하나. 아직 아무것도 정리되지 않았다. */
export interface RawLink {
  path: string[];
  label: string;
  href: string;
  onclick: string;
  elementId: string;
}

export interface ExtractResult {
  links: RawLink[];
  /** 어느 그릇에서 찾았는가. 회수율이 낮을 때 어디를 고칠지 알려 준다. */
  strategy: string;
  /** 후보 그릇들의 점수. 잘못 골랐는지 눈으로 확인할 수 있게 남긴다. */
  considered: { where: string; links: number; depth: number; score: number }[];
}

/** 전체메뉴를 여는 것으로 보이는 후보. 누르는 것은 Node 쪽에서 한다. */
export interface Trigger {
  index: number;
  label: string;
}

/**
 * 전체메뉴 후보를 **찾기만** 한다. 누르지는 않는다.
 *
 * <p>누르는 일을 Node로 뺀 이유가 있다. 신한은행에서 "전체메뉴 닫기" 버튼을 눌러
 * 패널을 <b>닫아 버렸고</b>, 그 결과 1,004개짜리 메뉴가 99개로 수집됐다. 눌러 보고
 * 링크가 늘었는지 확인한 다음 아니면 다음 후보로 넘어가야 하는데, 그 판단에는
 * 클릭 전후를 비교할 자리가 필요하다.
 */
export function findTriggersInPage(): Trigger[] {
  const OPEN = /전체\s*메뉴|전체서비스|사이트맵|모든\s*메뉴|메뉴\s*전체/;
  const CLOSE = /닫기|닫힘|close|hide/i;

  const found: Trigger[] = [];
  const all = Array.from(document.querySelectorAll("a, button, [role=button]"));

  all.forEach((el, index) => {
    const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const haystack = [
      label,
      el.getAttribute("title") ?? "",
      el.getAttribute("aria-label") ?? "",
      String(el.className ?? ""),
      el.id ?? "",
    ].join(" ");

    const looksLikeMenu = OPEN.test(haystack) || /allmenu|all-menu|sitemap/i.test(haystack);
    if (!looksLikeMenu) return;
    // 닫기 버튼은 열려 있는 패널을 접는다. 아예 후보에서 뺀다.
    if (CLOSE.test(haystack)) return;

    found.push({ index, label: label || String(el.className ?? "").slice(0, 30) });
  });

  return found;
}

/** 후보 하나를 누른다. `findTriggersInPage`가 준 순번 그대로여야 한다. */
export function clickTriggerInPage(index: number): boolean {
  const all = Array.from(document.querySelectorAll("a, button, [role=button]"));
  const el = all[index] as HTMLElement | undefined;
  if (!el) return false;
  try {
    el.click();
    return true;
  } catch {
    return false;
  }
}

/** 지금 문서에 보이는 링크 수. 트리거가 실제로 무언가를 폈는지 재는 자다. */
export function countLinksInPage(): number {
  return document.querySelectorAll("a").length;
}

/**
 * 메뉴를 읽는다.
 *
 * <p>핵심은 **뿌리를 점수로 고르는 것**이다. 전에는 "링크 20개가 넘으면 그것으로 확정"이었는데,
 * 그러면 머리글의 얕은 목록이 먼저 걸려 하위 메뉴를 통째로 놓친다. 실제로 세 사이트가
 * 깊이 0단만 수집됐다. 지금은 후보를 전부 훑고 <b>링크 수 × 계층 깊이</b>가 가장 큰 그릇을 고른다.
 * 계층이 있는 그릇이 곧 메뉴 트리다.
 */
export function extractInPage(): ExtractResult {
  const NOT_MENU = /^(검색|닫기|이전|다음|더보기|TOP|맨위로|로그인|로그아웃|홈|전체메뉴)$/;

  const text = (el: Element): string => {
    // 스크린리더용 대체 텍스트가 라벨인 경우가 있다(하나은행 depth1은 이미지다).
    const img = el.querySelector("img");
    const alt = (img?.getAttribute("alt") ?? "").trim();
    const own = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return own.length > 0 ? own : alt;
  };

  /** 이 항목 바로 아래에 달린 하위 목록. `li > div > ul`처럼 한 겹 싸인 것도 잡는다. */
  const nestedLists = (item: Element): Element[] =>
    Array.from(item.querySelectorAll("ul, ol, dl")).filter(
      (list) => list.closest("li, dd, dt") === item,
    );

  /** 항목 자신의 링크. 하위 목록 안의 링크는 자기 것이 아니다. */
  const ownAnchor = (item: Element): HTMLAnchorElement | null => {
    const anchors = Array.from(item.querySelectorAll("a"));
    for (const anchor of anchors) {
      if (anchor.closest("li, dd, dt") === item) return anchor as HTMLAnchorElement;
    }
    return null;
  };

  const collect = (root: Element): RawLink[] => {
    const out: RawLink[] = [];

    const walk = (list: Element, path: string[], depth: number): void => {
      if (depth > 5 || out.length > 5000) return;

      // `ul/ol`은 `li`, `dl`은 `dt`(머리) + `dd`(항목) 꼴이다.
      const items = Array.from(list.children).filter((child) =>
        /^(LI|DT|DD)$/.test(child.tagName),
      );

      let groupName = "";
      for (const item of items) {
        // dt는 뒤따르는 dd들의 이름표다. 링크가 없으면 이름만 얹는다.
        const isHead = item.tagName === "DT";
        const anchor = ownAnchor(item);
        const label = anchor ? text(anchor) : text(item);

        if (isHead && !anchor) {
          groupName = label;
          continue;
        }

        const here = groupName ? [...path, groupName] : path;

        if (anchor && label && !NOT_MENU.test(label)) {
          out.push({
            path: [...here],
            label,
            href: anchor.getAttribute("href") ?? "",
            onclick: anchor.getAttribute("onclick") ?? "",
            elementId: anchor.id || (anchor.querySelector("[id]")?.id ?? ""),
          });
        }

        const childPath = label && !NOT_MENU.test(label) ? [...here, label] : here;
        for (const sub of nestedLists(item)) walk(sub, childPath, depth + 1);
      }
    };

    // 남의 목록 안에 들어 있지 않은 최상위 목록만 시작점으로 삼는다.
    const roots = Array.from(root.querySelectorAll("ul, ol, dl")).filter(
      (list) => !list.parentElement?.closest("ul, ol, dl"),
    );
    for (const list of roots) walk(list, [], 0);
    return out;
  };

  /** 계층이 얼마나 깊은가. 깊이가 곧 "이게 메뉴 트리다"라는 신호다. */
  const maxDepth = (links: readonly RawLink[]): number =>
    links.reduce((max, link) => Math.max(max, link.path.length), 0);

  const candidateSelectors = [
    "[class*=allmenu] [class*=body]",
    "[class*=allMenu]",
    "[class*=allmenu]",
    "[class*=all-menu]",
    "[class*=sitemap]",
    "[class*=total-menu]",
    "[class*=gnb]",
    "[id*=gnb]",
    "nav",
    "header",
    "body",
  ];

  const considered: ExtractResult["considered"] = [];
  interface Best {
    links: RawLink[];
    where: string;
    score: number;
  }
  let best: Best | null = null;

  for (const selector of candidateSelectors) {
    const roots =
      selector === "body" ? [document.body] : Array.from(document.querySelectorAll(selector));
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (!root) continue;
      const links = collect(root);
      if (links.length === 0) continue;
      const depth = maxDepth(links);
      // 깊이가 없으면 메뉴 트리가 아니라 나열된 바로가기일 가능성이 크다.
      // 그래도 0으로 만들지는 않는다 — 계층이 정말 없는 사이트가 있다.
      const score = links.length * (1 + depth * 2);
      const where = `${selector}${roots.length > 1 ? `[${i}]` : ""}`;
      considered.push({ where, links: links.length, depth, score });
      if (best === null || score > best.score) best = { links, where, score };
    }
  }

  considered.sort((a, b) => b.score - a.score);

  if (best === null) return { links: [], strategy: "none", considered };
  return { links: best.links, strategy: best.where, considered: considered.slice(0, 6) };
}
