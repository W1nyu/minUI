import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuItem, RiskLevel } from "@minui/core";
import { attachOverrides, type Override } from "./overrides.js";

/**
 * 수집 원본 + 사람이 붙인 것 → `MenuCatalog`.
 *
 * <p>파일을 둘로 나눈 것이 이 스크립트의 존재 이유다. 사이트가 개편돼 다시 수집하면
 * `*.raw.json`은 통째로 덮어써지지만 `*.overrides.json`은 살아남는다. 동의어와 위험도는
 * 사람이 판단해서 붙인 것이라, 재수집 한 번에 날아가면 작업이 성립하지 않는다.
 *
 * <p>검증에서 걸리면 <b>빌드를 실패시킨다.</b> 특히 `riskLevel`을 기본값으로 통과시키면
 * 기획안 §9.3의 안전 경계가 조용히 뚫린다 — 음성으로 이체가 실행될 수 있게 된다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGS = join(HERE, "../catalogs");
const OUT_DIR = join(HERE, "../../demos/src/catalogs");

export const SITES = ["kbstar", "kbsec", "miraeasset", "shinhan"] as const;
export type Site = (typeof SITES)[number];

/**
 * 카테고리를 경로의 몇 번째에서 뽑을지.
 *
 * <p>사이트마다 최상위가 다른 것을 뜻한다. KB국민은행의 `개인뱅킹`과 신한의 `개인`은
 * 은행 부문 구분이라 카테고리로 쓸모가 없다 — 모든 메뉴가 한 갈래가 되어 되묻기
 * 선택지가 무의미해진다. 그 아래 `조회/이체/공과금`이 실제 갈래다.
 * 반대로 KB증권·미래에셋은 최상위가 이미 `금융상품/연금자산`이라 그대로 쓴다.
 */
const CATEGORY_DEPTH: Record<Site, number> = {
  kbstar: 1,
  shinhan: 1,
  kbsec: 0,
  miraeasset: 0,
};

interface RawItem {
  path: string[];
  label: string;
  key: string;
}

interface RawFile {
  source: { site: string; host: string; capturedAt: string; note?: string };
  items: RawItem[];
}


// ── 라벨 정리 ────────────────────────────────────────────────────────────

/**
 * 수집물에 섞여 들어오는 것들.
 *
 * <p>미래에셋은 앵커 안에 `<span class="mb">로그인필요</span>` 같은 스크린리더용 배지를
 * 두는데, 그대로 두면 "이체로그인필요"가 메뉴 이름이 된다. 수집 스니펫에서 걸러도 되지만
 * 여기서 하는 편이 낫다 — 재수집할 때마다 스니펫을 다시 고칠 필요가 없다.
 */
const LABEL_NOISE = [
  /로그인\s*필요$/,
  /새창\s*열기$/,
  /새\s*창$/,
  /바로가기$/,
  /\s*열기$/,
  /하위메뉴$/,
];

/** 메뉴가 아닌 것. 사이트 UI 컨트롤이 링크로 만들어져 섞여 들어온다. */
const NOT_A_MENU = new Set([
  "검색창 열기",
  "검색창",
  "전체메뉴 열기",
  "전체메뉴",
  "전체 메뉴 보기",
  "이전",
  "다음",
  "닫기",
  "더보기",
  "TOP",
]);

function cleanLabel(raw: string): string {
  let label = raw.replace(/\s+/g, " ").trim();
  for (const pattern of LABEL_NOISE) label = label.replace(pattern, "").trim();
  return label;
}

// ── 안전 검증 ────────────────────────────────────────────────────────────

/**
 * 개인정보가 라벨에 섞여 들어왔는가.
 *
 * <p>KB국민은행과 미래에셋을 로그인 상태에서 수집했다. 내비게이션만 읽었지만,
 * 사이트가 메뉴 영역에 사용자 이름이나 계좌번호를 넣는 경우가 있다.
 * 여기서 걸러야 그것이 저장소에 커밋되지 않는다.
 */
const PERSONAL_DATA = [
  { name: "계좌번호 형태", pattern: /\d{2,6}-\d{2,6}-\d{4,}/ },
  { name: "연속 숫자 8자리 이상", pattern: /\d{8,}/ },
  { name: "이름+님", pattern: /[가-힣]{2,4}\s*님/ },
  { name: "이메일", pattern: /[\w.+-]+@[\w-]+\.[\w.]+/ },
];

/** 자금이 움직이거나 인증을 건드리는 갈래. 음성 자동 실행을 막아야 한다 (§9.3). */
const HIGH_RISK_HINTS =
  /이체|송금|출금|해지|비밀번호|비번|인증|보안|한도|등록|변경|신청|매수|매도|주문|청약|대출실행|OTP/;

/** 실시간성이 중요해 카드로 고정하기에 맞지 않는 화면 (§15). */
const NOT_CARDABLE_HINTS = /시세|호가|차트|실시간|현재가|체결|지수|랭킹|종목검색/;

function guessRiskLevel(item: RawItem): RiskLevel {
  const haystack = [...item.path, item.label].join(" ");
  return HIGH_RISK_HINTS.test(haystack) ? "high" : "low";
}

// ── 동의어 ────────────────────────────────────────────────────────────────

/**
 * 동의어는 자동 생성하지 않는다. 재 보고 내린 결론이다.
 *
 * <p>두 가지를 시도했고 둘 다 기여가 0이었다.
 * <ol>
 *   <li>라벨 조각을 그대로 동의어로 — 오히려 정확도가 떨어졌다. "잔액"을 가진 메뉴가
 *       수십 개가 되면서 "잔액 좀 보자"가 계좌조회 대신 "잔액 모으기"에 걸렸다
 *   <li>금융 용어 사전으로 문구 치환 ("자동이체 해지" + 해지→그만두기) — 1회 질의
 *       정확 매칭 기여 0%, 후보 3개 포함도 순증 0. 색인만 두 배로 불었다
 *       (신한 566KB → 1,135KB)
 * </ol>
 *
 * <p>왜 안 되는지가 분명하다. 사용자는 "계좌조회"를 <b>"잔액"</b>이라고 부르는데,
 * 라벨에 그 말이 없으니 라벨을 아무리 변형해도 나오지 않는다. 필요한 것은 용어 대응이
 * 아니라 <b>사람이 그것을 뭐라고 부르는가</b>이고, 그 정보는 라벨 안에 없다.
 * M4에서 n-gram 유사도의 기여가 0이었던 것과 같은 벽이다.
 *
 * <p>그래서 동의어는 overrides에 사람이 쓴 것만 쓴다. 나머지 메뉴도 자기 라벨로는
 * 검색되므로 "펀드검색"은 "펀드"로 찾힌다 — 못 찾는 것은 라벨에 없는 구어뿐이다.
 * glossary.json은 동의어를 쓸 때 참고할 용어집으로 남겨 둔다.
 */

// ── id ───────────────────────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .replace(/[^\w가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * 수집 key → 메뉴 id.
 *
 * <p>사이트가 안정적인 코드를 주면 그것을 쓴다(KB국민은행 `page:`, KB증권 `linkcd:`).
 * 신한은행과 미래에셋은 링크가 `javascript:`뿐이라 코드가 아예 없어 라벨 경로로 만든다.
 * <b>라벨 기반 id는 사이트가 문구를 바꾸면 끊어진다</b> — overrides가 함께 무효가 되므로,
 * 재수집 시 끊어진 id를 리포트한다.
 */
function toId(site: Site, item: RawItem, cleanPath: string[], label: string): string {
  const [kind, ...rest] = item.key.split(":");
  const value = rest.join(":");

  if (kind === "page" || kind === "linkcd") return `${site}.${value}`;
  if (kind === "path" && value && value !== "/" && !/void|null/.test(value)) {
    return `${site}.${slugify(value)}`;
  }
  // 라벨로 id를 만들 때는 **정리된** 경로를 쓴다. 원본 경로에는 "로그인필요" 같은
  // 스크린리더용 배지가 섞여 있어, 그대로 두면 id에 그 문구가 박힌다.
  return `${site}.${slugify([...cleanPath, label].join("-"))}`;
}

// ── 빌드 ─────────────────────────────────────────────────────────────────

interface BuildResult {
  site: Site;
  menus: MenuItem[];
  stats: {
    raw: number;
    excluded: number;
    deduped: number;
    handSynonyms: number;
    autoSynonyms: number;
    highRisk: number;
    notCardable: number;
    unstableIds: number;
    /** id가 끊어졌지만 라벨·자모로 다시 붙인 override 수. */
    rematched: number;
  };
  problems: string[];
  /** 어디에도 붙지 못한 override. 사람이 봐야 한다. */
  orphans: { key: string; suggestion: string | null; score: number }[];
  /** 자동으로 다시 붙인 것들. 눈으로 확인하라고 남긴다. */
  remaps: { from: string; to: string; how: string }[];
}


function build(site: Site): BuildResult {
  const raw = JSON.parse(
    readFileSync(join(CATALOGS, `${site}.raw.json`), "utf8"),
  ) as RawFile;

  const overridesPath = join(CATALOGS, `${site}.overrides.json`);
  const overrides: Record<string, Override> = existsSync(overridesPath)
    ? (JSON.parse(readFileSync(overridesPath, "utf8")) as Record<string, Override>)
    : {};

  const problems: string[] = [];
  const menus: MenuItem[] = [];
  const byId = new Map<string, MenuItem>();
  let excluded = 0;
  let deduped = 0;
  let handSynonyms = 0;
  let autoCount = 0;
  let unstableIds = 0;

  for (const item of raw.items) {
    const label = cleanLabel(item.label);
    // 원문과 정리본 양쪽으로 확인한다. "검색창 열기"는 정리하면 "검색창"이 되는데,
    // 그것도 메뉴가 아니다.
    if (!label || NOT_A_MENU.has(label) || NOT_A_MENU.has(item.label.trim())) {
      excluded += 1;
      continue;
    }

    const cleanPath = item.path.map(cleanLabel).filter(Boolean);

    // 그룹 자체가 메뉴가 아니면 그 아래도 전부 메뉴가 아니다.
    // 미래에셋의 "검색창 열기" 아래에는 인기 검색어(#추천상품)가 들어 있다.
    if (cleanPath.some((p) => NOT_A_MENU.has(p))) {
      excluded += 1;
      continue;
    }

    for (const check of PERSONAL_DATA) {
      if (check.pattern.test(label) || cleanPath.some((p) => check.pattern.test(p))) {
        problems.push(`[개인정보 의심 · ${check.name}] ${cleanPath.join(">")} > ${label}`);
      }
    }

    const id = toId(site, item, cleanPath, label);
    if (id.startsWith(`${site}.`) && item.key.startsWith("label:")) unstableIds += 1;

    if (byId.has(id)) {
      deduped += 1;
      continue;
    }

    const category = cleanPath[CATEGORY_DEPTH[site]] ?? cleanPath[0] ?? "기타";
    const haystack = [...cleanPath, label].join(" ");

    // 1차: 사이트에서 온 것만으로 메뉴를 만든다. override는 붙인 뒤에 얹는다 —
    // 그래야 id가 끊어진 override도 라벨로 다시 붙일 기회를 갖는다.
    const menu: MenuItem = {
      id,
      label,
      // 자동 생성은 재 보고 껐다. 아래 autoSynonyms 주석 참고.
      synonyms: [],
      category,
      icon: "doc",
      // 실제 라우팅은 하지 않는다. 데모의 ActionHandler가 스텁 화면을 연다.
      route: `/${id}`,
      riskLevel: guessRiskLevel({ ...item, label }),
      ...(NOT_CARDABLE_HINTS.test(haystack) ? { cardable: false } : {}),
    };

    byId.set(id, menu);
    menus.push(menu);
  }

  // 2차: override를 붙인다. id 일치 → match.label → 자모 유사도 순.
  const { resolved, remaps, orphans } = attachOverrides(menus, overrides);

  const kept: MenuItem[] = [];
  for (const menu of menus) {
    const override = resolved.get(menu.id);
    if (override?.exclude) {
      excluded += 1;
      continue;
    }

    if (override?.synonyms && override.synonyms.length > 0) {
      menu.synonyms = override.synonyms;
      handSynonyms += 1;
    } else {
      autoCount += 1;
    }
    if (override?.riskLevel) menu.riskLevel = override.riskLevel;
    if (override?.icon) menu.icon = override.icon;
    if (override?.cardable !== undefined) menu.cardable = override.cardable;

    kept.push(menu);
  }

  return {
    site,
    menus: kept,
    stats: {
      raw: raw.items.length,
      excluded,
      deduped,
      handSynonyms,
      autoSynonyms: autoCount,
      highRisk: kept.filter((m) => m.riskLevel === "high").length,
      notCardable: kept.filter((m) => m.cardable === false).length,
      unstableIds,
      rematched: remaps.length,
    },
    problems,
    remaps,
    orphans,
  };
}

// ── 실행 ─────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const results = SITES.map(build);
const allProblems = results.flatMap((r) => r.problems.map((p) => `${r.site}: ${p}`));

console.log(
  `\n  ${"사이트".padEnd(12)}${"원본".padStart(7)}${"메뉴".padStart(7)}${"제외".padStart(7)}` +
    `${"중복".padStart(7)}${"수작업".padStart(9)}${"high".padStart(7)}${"카드제외".padStart(9)}${"불안정id".padStart(9)}${"재연결".padStart(8)}`,
);

for (const r of results) {
  console.log(
    `  ${r.site.padEnd(12)}${String(r.stats.raw).padStart(7)}${String(r.menus.length).padStart(7)}` +
      `${String(r.stats.excluded).padStart(7)}${String(r.stats.deduped).padStart(7)}` +
      `${String(r.stats.handSynonyms).padStart(9)}${String(r.stats.highRisk).padStart(7)}` +
      `${String(r.stats.notCardable).padStart(9)}${String(r.stats.unstableIds).padStart(9)}${String(r.stats.rematched).padStart(8)}`,
  );
  writeFileSync(
    join(OUT_DIR, `${r.site}.json`),
    `${JSON.stringify(r.menus, null, 2)}\n`,
    "utf8",
  );
}

console.log(`\n  총 ${results.reduce((n, r) => n + r.menus.length, 0)}개 메뉴 → ${OUT_DIR}`);

// ── 표류 리포트 ──────────────────────────────────────────────────────────
// id가 끊어진 override를 어떻게 처리했는지 전부 드러낸다. 자동으로 붙였더라도
// 조용히 넘어가면 안 된다 — 엉뚱한 메뉴에 동의어가 붙는 것이 안 붙는 것보다 나쁘다.

const remaps = results.flatMap((r) => r.remaps.map((m) => ({ site: r.site, ...m })));
const orphans = results.flatMap((r) => r.orphans.map((o) => ({ site: r.site, ...o })));

if (remaps.length > 0) {
  console.log(`\n  id가 끊어져 다시 붙인 override ${remaps.length}건 — 확인하세요`);
  for (const m of remaps.slice(0, 20)) {
    console.log(`    ${m.site}: ${m.from}\n      → ${m.to}  (${m.how})`);
  }
}

if (orphans.length > 0) {
  console.log(`\n  붙지 못한 override ${orphans.length}건`);
  for (const o of orphans.slice(0, 20)) {
    console.log(
      `    ${o.site}: ${o.key}` +
        (o.suggestion ? `\n      가장 가까운 메뉴: ${o.suggestion} (${o.score.toFixed(2)})` : ""),
    );
  }
  console.log(
    `\n  이 항목들은 사이트가 메뉴를 없앴거나 문구를 크게 바꾼 것이다.` +
      `\n  overrides에 match: { label: "..." }를 넣으면 id와 무관하게 붙는다.`,
  );
}

if (allProblems.length > 0) {
  console.error(`\n검증 실패 — ${allProblems.length}건\n`);
  for (const p of allProblems.slice(0, 30)) console.error(`  ${p}`);
  if (allProblems.length > 30) console.error(`  … 외 ${allProblems.length - 30}건`);
  process.exitCode = 1;
} else {
  console.log("  개인정보 검증 통과\n");
}
