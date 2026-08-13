import { extractInPage, findTriggersInPage, type RawLink } from "./extract.js";
import { deriveKey, isSameSite } from "./keys.js";

/**
 * 브라우저 콘솔에 붙여넣어 돌리는 수집기.
 *
 * <p>서버 수집이 못 하는 일이 하나 있다 — **로그인 뒤에만 보이는 메뉴**다.
 * KB국민은행 개인뱅킹 전체메뉴가 그렇고, 실측에서 회수율 3%로 드러났다(다른 네 곳은 99%).
 * 은행 입장에서는 그 메뉴가 오히려 본체다.
 *
 * <p>그래서 같은 추출 로직을 **사용자의 브라우저에서** 돌린다. 자기 계정으로 로그인한
 * 그 화면에서 실행하므로 서버가 못 보는 것을 본다. 그리고 이 방식에는 부수 효과가 있다 —
 * <b>수집물이 서버를 거치지 않는다.</b> 파일이 사용자 컴퓨터로 바로 내려간다.
 *
 * <p>추출·id 규칙은 서버 수집과 **같은 파일을 쓴다.** 따로 두면 한쪽만 고쳐지고,
 * 그러면 두 경로가 다른 카탈로그를 만들어 낸다.
 */

declare global {
  interface Window {
    minuiHarvest?: () => Promise<void>;
  }
}

/**
 * 페이지가 덮어쓴 전역을 믿지 않고 직렬화한다.
 *
 * <p>하나은행 페이지는 `Array.prototype.toJSON`을 정의해 둔다. 그러면 `JSON.stringify`가
 * <b>배열을 문자열로</b> 바꾼다 — `{a:[1,2]}`가 `{"a":"[1, 2]"}`가 된다. 그대로 내려받으면
 * `items`가 배열이 아니라 문자열인 파일이 나오고, 그 뒤 단계가 전부 조용히 어긋난다.
 * 실제로 그 파일을 한 번 만들어 냈다.
 *
 * <p>남의 페이지 안에서 도는 코드는 그 페이지가 무엇을 고쳐 놨는지 알 수 없다.
 * 직렬화하는 동안만 `toJSON`을 떼어 두고 끝나면 되돌려 놓는다 — 페이지의 동작을 바꾸지 않는다.
 */
function safeStringify(value: unknown): string {
  const proto = Array.prototype as unknown as { toJSON?: unknown };
  const stashed = proto.toJSON;
  if (stashed !== undefined) delete proto.toJSON;
  try {
    return JSON.stringify(value, null, 2);
  } finally {
    if (stashed !== undefined) proto.toJSON = stashed;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 전체메뉴를 연다. 누른 뒤 링크가 늘었는지 보고 아니면 다음 후보로 — 서버 쪽과 같은 규칙. */
async function openAllMenu(): Promise<string> {
  const triggers = findTriggersInPage();
  const before = document.querySelectorAll("a").length;

  for (const trigger of triggers.slice(0, 6)) {
    const all = Array.from(document.querySelectorAll("a, button, [role=button]"));
    const el = all[trigger.index] as HTMLElement | undefined;
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

function toItems(links: readonly RawLink[], host: string) {
  const items: { path: string[]; label: string; key: string }[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const label = link.label.replace(/\s+/g, " ").trim();
    if (!label) continue;
    if (link.href && !isSameSite(link.href, host)) continue;

    const key = deriveKey({
      href: link.href,
      onclick: link.onclick,
      elementId: link.elementId,
      path: link.path,
      label,
    });

    const fingerprint = `${link.path.join(">")}|${label}|${key}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    items.push({ path: link.path, label, key });
  }
  return items;
}

async function run(): Promise<void> {
  const host = location.host;
  const site = host.replace(/^www\./, "").split(".")[0] ?? host;

  const trigger = await openAllMenu();
  const extracted = extractInPage();
  const items = toItems(extracted.links, host);

  const file = {
    source: {
      site,
      host,
      capturedAt: new Date().toISOString(),
      note: `브라우저에서 수집. 전략=${extracted.strategy}. 로그인 상태일 수 있음 — 내비게이션만 읽음.`,
    },
    items,
  };

  const blob = new Blob([`${safeStringify(file)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${site}.raw.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);

  const depths = new Map<number, number>();
  for (const item of items) depths.set(item.path.length, (depths.get(item.path.length) ?? 0) + 1);

  console.log(
    `[MinUI] 메뉴 ${items.length}개를 ${site}.raw.json 으로 내려받았습니다.\n` +
      `  전략 ${extracted.strategy}\n` +
      `  트리거 ${trigger || "(누를 것 없음)"}\n` +
      `  깊이별 ${[...depths.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([depth, count]) => `${depth}단 ${count}`)
        .join(" · ")}`,
  );
}

window.minuiHarvest = run;
void run();
