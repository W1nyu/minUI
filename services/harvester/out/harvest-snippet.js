/* MinUI 수집 스니펫 — 로그인한 사이트의 콘솔에 붙여넣으세요 */
"use strict";
(() => {
  // src/extract.ts
  function findTriggersInPage() {
    const OPEN = /전체\s*메뉴|전체서비스|사이트맵|모든\s*메뉴|메뉴\s*전체/;
    const CLOSE = /닫기|닫힘|close|hide/i;
    const found = [];
    const all = Array.from(document.querySelectorAll("a, button, [role=button]"));
    all.forEach((el, index) => {
      const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const haystack = [
        label,
        el.getAttribute("title") ?? "",
        el.getAttribute("aria-label") ?? "",
        String(el.className ?? ""),
        el.id ?? ""
      ].join(" ");
      const looksLikeMenu = OPEN.test(haystack) || /allmenu|all-menu|sitemap/i.test(haystack);
      if (!looksLikeMenu) return;
      if (CLOSE.test(haystack)) return;
      found.push({ index, label: label || String(el.className ?? "").slice(0, 30) });
    });
    return found;
  }
  function extractInPage() {
    const NOT_MENU = /^(검색|닫기|이전|다음|더보기|TOP|맨위로|로그인|로그아웃|홈|전체메뉴)$/;
    const text = (el) => {
      const img = el.querySelector("img");
      const alt = (img?.getAttribute("alt") ?? "").trim();
      const own = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return own.length > 0 ? own : alt;
    };
    const nestedLists = (item) => Array.from(item.querySelectorAll("ul, ol, dl")).filter(
      (list) => list.closest("li, dd, dt") === item
    );
    const ownAnchor = (item) => {
      const anchors = Array.from(item.querySelectorAll("a"));
      for (const anchor of anchors) {
        if (anchor.closest("li, dd, dt") === item) return anchor;
      }
      return null;
    };
    const collect = (root) => {
      const out = [];
      const walk = (list, path, depth) => {
        if (depth > 5 || out.length > 5e3) return;
        const items = Array.from(list.children).filter(
          (child) => /^(LI|DT|DD)$/.test(child.tagName)
        );
        let groupName = "";
        for (const item of items) {
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
              elementId: anchor.id || (anchor.querySelector("[id]")?.id ?? "")
            });
          }
          const childPath = label && !NOT_MENU.test(label) ? [...here, label] : here;
          for (const sub of nestedLists(item)) walk(sub, childPath, depth + 1);
        }
      };
      const roots = Array.from(root.querySelectorAll("ul, ol, dl")).filter(
        (list) => !list.parentElement?.closest("ul, ol, dl")
      );
      for (const list of roots) walk(list, [], 0);
      return out;
    };
    const maxDepth = (links) => links.reduce((max, link) => Math.max(max, link.path.length), 0);
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
      "body"
    ];
    const considered = [];
    let best = null;
    for (const selector of candidateSelectors) {
      const roots = selector === "body" ? [document.body] : Array.from(document.querySelectorAll(selector));
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (!root) continue;
        const links = collect(root);
        if (links.length === 0) continue;
        const depth = maxDepth(links);
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

  // src/keys.ts
  var CODE_PARAMS = ["page", "linkcd", "menucd", "menuid", "menu_id", "mnuid", "cmd"];
  function usableCode(value) {
    if (!value) return false;
    const trimmed = value.trim();
    if (trimmed.length < 3 || trimmed.length > 40) return false;
    return /^[\w.-]+$/.test(trimmed);
  }
  function deriveKey(facts) {
    const href = (facts.href ?? "").trim();
    const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    if (query) {
      const params = /* @__PURE__ */ new Map();
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
    const fromClick = firstCode(facts.onclick);
    if (fromClick) return `code:${fromClick}`;
    const fromId = firstCode(facts.elementId);
    if (fromId) return `code:${fromId}`;
    const pathname = toPathname(href);
    if (pathname && pathname !== "/" && !/^\/?(void|null)/.test(pathname)) {
      return `path:${pathname}`;
    }
    return `label:${[...facts.path, facts.label].join("/")}`;
  }
  function firstCode(source) {
    if (!source) return null;
    const match = source.match(/\d{4,}/);
    return match ? match[0] : null;
  }
  function decodeSafely(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  function toPathname(href) {
    if (!href || href.startsWith("#")) return null;
    if (/^(javascript|mailto|tel):/i.test(href)) return null;
    let rest = href;
    const scheme = rest.match(/^https?:\/\/[^/]+/i);
    if (scheme) rest = rest.slice(scheme[0].length);
    const cut = Math.min(
      ...[rest.indexOf("?"), rest.indexOf("#")].filter((i) => i >= 0).concat([rest.length])
    );
    const pathname = rest.slice(0, cut);
    return pathname.length > 0 ? pathname : null;
  }
  function isSameSite(href, host) {
    const trimmed = href.trim();
    if (!trimmed) return false;
    if (/^(javascript|mailto|tel):/i.test(trimmed)) return true;
    if (!/^https?:\/\//i.test(trimmed)) return true;
    const linkHost = trimmed.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() ?? "";
    const registrable = (value) => value.split(".").slice(-2).join(".");
    return registrable(linkHost) === registrable(host.toLowerCase());
  }

  // src/snippet-entry.ts
  function safeStringify(value) {
    const proto = Array.prototype;
    const stashed = proto.toJSON;
    if (stashed !== void 0) delete proto.toJSON;
    try {
      return JSON.stringify(value, null, 2);
    } finally {
      if (stashed !== void 0) proto.toJSON = stashed;
    }
  }
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function openAllMenu() {
    const triggers = findTriggersInPage();
    const before = document.querySelectorAll("a").length;
    for (const trigger of triggers.slice(0, 6)) {
      const all = Array.from(document.querySelectorAll("a, button, [role=button]"));
      const el = all[trigger.index];
      if (!el) continue;
      try {
        el.click();
      } catch {
        continue;
      }
      await sleep(1200);
      if (document.querySelectorAll("a").length > before * 1.1) return trigger.label;
    }
    return "";
  }
  function toItems(links, host) {
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    for (const link of links) {
      const label = link.label.replace(/\s+/g, " ").trim();
      if (!label) continue;
      if (link.href && !isSameSite(link.href, host)) continue;
      const key = deriveKey({
        href: link.href,
        onclick: link.onclick,
        elementId: link.elementId,
        path: link.path,
        label
      });
      const fingerprint = `${link.path.join(">")}|${label}|${key}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      items.push({ path: link.path, label, key });
    }
    return items;
  }
  async function run() {
    const host = location.host;
    const site = host.replace(/^www\./, "").split(".")[0] ?? host;
    const trigger = await openAllMenu();
    const extracted = extractInPage();
    const items = toItems(extracted.links, host);
    const file = {
      source: {
        site,
        host,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        note: `\uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC218\uC9D1. \uC804\uB7B5=${extracted.strategy}. \uB85C\uADF8\uC778 \uC0C1\uD0DC\uC77C \uC218 \uC788\uC74C \u2014 \uB0B4\uBE44\uAC8C\uC774\uC158\uB9CC \uC77D\uC74C.`
      },
      items
    };
    const blob = new Blob([`${safeStringify(file)}
`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${site}.raw.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3e3);
    const depths = /* @__PURE__ */ new Map();
    for (const item of items) depths.set(item.path.length, (depths.get(item.path.length) ?? 0) + 1);
    console.log(
      `[MinUI] \uBA54\uB274 ${items.length}\uAC1C\uB97C ${site}.raw.json \uC73C\uB85C \uB0B4\uB824\uBC1B\uC558\uC2B5\uB2C8\uB2E4.
  \uC804\uB7B5 ${extracted.strategy}
  \uD2B8\uB9AC\uAC70 ${trigger || "(\uB204\uB97C \uAC83 \uC5C6\uC74C)"}
  \uAE4A\uC774\uBCC4 ${[...depths.entries()].sort((a, b) => a[0] - b[0]).map(([depth, count]) => `${depth}\uB2E8 ${count}`).join(" \xB7 ")}`
    );
  }
  window.minuiHarvest = run;
  void run();
})();
