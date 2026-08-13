import { chromium } from "playwright-core";

/**
 * 왜 못 읽었는지 본다.
 *
 * <p>수집기를 고칠 때 DOM을 추측하면 사이트마다 한 번씩 틀린다. 실패한 사이트에서
 * **링크가 실제로 어디에 몇 개 들어 있는지** 먼저 세고 나서 고친다.
 *
 * <p>`pnpm --filter @minui/harvester probe -- <URL>`
 */

const [url] = process.argv.slice(2);
if (!url) {
  console.error("쓰는 법: probe -- <URL>");
  process.exit(1);
}

const SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() =>
  chromium.launch({ headless: true }),
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

await page.evaluate(SHIM);
await page
  .evaluate(`(function () {
    var re = /전체\\s*메뉴|전체서비스|사이트맵|모든\\s*메뉴/;
    var all = document.querySelectorAll('a, button, [role=button]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var hay = (el.textContent || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.className || '');
      if (re.test(hay) || /allmenu|all-menu|sitemap/i.test(hay)) { try { el.click(); return; } catch (e) {} }
    }
  })()`)
  .catch(() => {});
await page.waitForTimeout(1500);

for (const frame of page.frames()) {
  await frame.evaluate(SHIM).catch(() => {});
  const report = await frame
    .evaluate(`(function () {
      function depthOf(root) {
        var max = 0;
        var lists = root.querySelectorAll('ul, ol, dl');
        for (var i = 0; i < lists.length; i++) {
          var d = 0, p = lists[i].parentElement;
          while (p && p !== root) { if (/^(UL|OL|DL)$/.test(p.tagName)) d++; p = p.parentElement; }
          if (d > max) max = d;
        }
        return max;
      }
      var seen = [];
      var nodes = document.querySelectorAll('div, nav, section, ul, dl');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var n = el.querySelectorAll('a').length;
        if (n < 40) continue;
        // 부모가 이미 비슷한 수를 담고 있으면 건너뛴다 — 가장 좁은 그릇만 본다.
        var parent = el.parentElement;
        if (parent && parent.querySelectorAll('a').length <= n * 1.15) continue;
        seen.push({
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 40),
          id: el.id || '',
          links: n,
          listDepth: depthOf(el),
          uls: el.querySelectorAll('ul').length,
          dls: el.querySelectorAll('dl').length,
          liWithNestedList: el.querySelectorAll('li ul, li ol, li dl').length,
        });
      }
      return { url: location.href, total: document.querySelectorAll('a').length, containers: seen.slice(0, 8) };
    })()`)
    .catch(() => null);
  if (report && (report as { total: number }).total > 30) {
    console.log(JSON.stringify(report, null, 1));
  }
}

await browser.close();
