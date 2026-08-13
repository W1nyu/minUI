import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanLabel, isMenuLabel } from "../../../tools/src/labels.js";

/**
 * 자동 수집이 손 수집을 얼마나 따라잡는가.
 *
 * <p>수집기 품질을 "몇 개 긁었나"로 재면 안 된다. 머리글·바닥글 링크를 잔뜩 담아도
 * 숫자는 커진다. <b>손으로 모은 것을 얼마나 되찾았는가(회수율)</b>가 진짜 지표다.
 *
 * <p>라벨로 대조하는 이유는 id가 사이트마다 다른 자리에서 오기 때문이다. 손 수집은
 * 사이트별 스니펫으로 코드를 정확히 뽑았지만 자동 수집은 사다리를 따라간다 —
 * 같은 메뉴라도 key가 다를 수 있다. 사용자가 보는 것은 라벨이므로 그것으로 잰다.
 *
 * <p><b>빌더와 같은 정리 규칙을 쓴다</b>(`tools/src/labels.ts`). 처음에는 정리 전 라벨로
 * 비교했는데, KB증권이 놓쳤다는 76건 중 대부분이 `"펀드몰 하위메뉴"` 같은 스크린리더용
 * 문구였다. 빌더가 어차피 지우므로 카탈로그에는 애초에 없다 — 자동 수집이 실제보다
 * 나빠 보였던 것이다. 카탈로그에 실제로 들어가는 것끼리 비교해야 뜻이 있다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGS = join(HERE, "../../../tools/catalogs");

interface RawFile {
  source: { site: string; host: string; note?: string };
  items: { path: string[]; label: string; key: string }[];
}

const SITES = ["kbstar", "kbsec", "miraeasset", "shinhan", "kebhana"] as const;

/** 손 수집이 로그인 상태에서 이뤄진 곳. 자동 수집은 그 메뉴를 볼 수 없다. */
const BEHIND_LOGIN: Partial<Record<(typeof SITES)[number], string>> = {
  kbstar: "손 수집은 obank.kbstar.com에 로그인한 상태에서 했다. 공개 페이지에는 그 메뉴가 없다.",
};

function load(name: string): RawFile | null {
  try {
    return JSON.parse(readFileSync(join(CATALOGS, `${name}.raw.json`), "utf8")) as RawFile;
  } catch {
    return null;
  }
}

/** 카탈로그에 실제로 들어갈 모습으로 맞춘다. 메뉴가 아닌 것은 null. */
const norm = (label: string): string | null =>
  isMenuLabel(label) ? cleanLabel(label).replace(/\s+/g, "").toLowerCase() : null;

const labelSet = (items: { label: string }[]): Set<string> => {
  const out = new Set<string>();
  for (const item of items) {
    const key = norm(item.label);
    if (key) out.add(key);
  }
  return out;
};

interface Row {
  site: string;
  hand: number;
  auto: number;
  recovered: number;
  extra: number;
  keyed: number;
  note: string;
}

const rows: Row[] = [];

for (const site of SITES) {
  const hand = load(site);
  const auto = load(`${site}-auto`);
  if (!hand || !auto) continue;

  const handLabels = labelSet(hand.items);
  const autoLabels = labelSet(auto.items);

  let recovered = 0;
  for (const label of handLabels) if (autoLabels.has(label)) recovered += 1;

  let extra = 0;
  for (const label of autoLabels) if (!handLabels.has(label)) extra += 1;

  // 라벨이 아닌 코드로 id를 만든 비율. 높을수록 사이트 개편에 강하다.
  const keyed = auto.items.filter((item) => !item.key.startsWith("label:")).length;

  rows.push({
    site,
    hand: handLabels.size,
    auto: autoLabels.size,
    recovered,
    extra,
    keyed: auto.items.length > 0 ? Math.round((keyed / auto.items.length) * 100) : 0,
    note: BEHIND_LOGIN[site] ?? "",
  });
}

const pct = (n: number, total: number) => (total === 0 ? "—" : `${Math.round((n / total) * 100)}%`);

console.log(`\n  자동 수집 회수율 — 손 수집본과 라벨로 대조\n`);
console.log(
  `  ${"사이트".padEnd(12)}${"손".padStart(7)}${"자동".padStart(7)}${"되찾음".padStart(12)}` +
    `${"덤".padStart(8)}${"코드 id".padStart(9)}`,
);

for (const row of rows) {
  console.log(
    `  ${row.site.padEnd(12)}${String(row.hand).padStart(7)}${String(row.auto).padStart(7)}` +
      `${`${row.recovered} ${pct(row.recovered, row.hand)}`.padStart(12)}` +
      `${String(row.extra).padStart(8)}${`${row.keyed}%`.padStart(9)}`,
  );
}

const scored = rows.filter((row) => row.note === "");
const handTotal = scored.reduce((sum, row) => sum + row.hand, 0);
const recoveredTotal = scored.reduce((sum, row) => sum + row.recovered, 0);

console.log(
  `\n  로그인이 필요한 곳을 뺀 회수율  ${recoveredTotal}/${handTotal} ` +
    `${pct(recoveredTotal, handTotal)}\n`,
);

for (const row of rows) {
  if (row.note) console.log(`  ※ ${row.site} — ${row.note}`);
}

console.log(
  `\n  "덤"은 손 수집이 놓쳤거나 자동 수집이 잘못 담은 것이다. 둘을 여기서 구분하지 않는다 —` +
    `\n  구분하려면 사람이 목록을 봐야 하고, 그것을 자동으로 정하면 측정이 자기 채점이 된다.\n`,
);
