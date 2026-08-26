import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuCatalog, MenuItem } from "@minui/core";
import {
  dropNearDuplicates,
  makeEnvelope,
  pickEvenly,
  type Envelope,
} from "./eval-prompts.js";

/**
 * 제3자에게 돌릴 **문항지**와, 나만 보는 **정답지**를 뽑는다 (M11 Task 13).
 *
 * <p>`report:contamination`이 깨끗한 질의가 75건 중 1건뿐이라고 답했다. 그 크기로는
 * 신경망이 이겼는지 졌는지 말할 수 없다 — 그래서 <b>정답의 글자를 본 적 없는 사람</b>에게
 * 질의를 받는다. 이 스크립트가 만드는 것은 그 사람에게 건넬 종이 한 장이다.
 *
 * <p>문항지에는 라벨도 동의어도 없다. 있는 것은 갈래(흘리는 조각을 뺀)와 뜻풀이뿐이고,
 * 그 뜻풀이가 정답의 글자를 흘리지 않는지는 `makeEnvelope`가 검사한다.
 *
 * <p>산출물은 `tools/out/`에 둔다 — gitignore된 자리다. <b>정답지가 저장소에 들어가면
 * 다음 사람이 그것을 보고 질의를 쓰게 된다.</b>
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../out");
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;

const perSite = Number(process.argv[2] ?? 16);

interface Ai {
  hint?: string;
}
interface Override {
  synonyms?: string[];
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

interface Picked {
  site: string;
  menu: MenuItem;
  envelope: Envelope;
}

const picked: Picked[] = [];
const tally = new Map<string, number>();
const bump = (reason: string) => tally.set(reason, (tally.get(reason) ?? 0) + 1);

for (const site of SITES) {
  const catalog = readJson<MenuCatalog>(
    join(HERE, `../../demos/src/catalogs/${site}.json`),
    [],
  );
  const ai = readJson<Record<string, Ai>>(join(HERE, `../catalogs/${site}.ai.json`), {});
  const overrides = readJson<Record<string, Override>>(
    join(HERE, `../catalogs/${site}.overrides.json`),
    {},
  );

  /** 누군가의 조상으로 등장하는 이름 전부. 그것이 갈래다. */
  const parents = new Set<string>();
  for (const menu of catalog) for (const segment of menu.path ?? []) parents.add(segment);

  const usable: Picked[] = [];
  for (const menu of catalog) {
    /*
     * 갈래(자식 있는 상위 메뉴)는 뺀다. 목적지가 아니라 길목이라 "이걸 하려면 뭐라고
     * 말하겠나"라는 물음이 성립하지 않는다.
     *
     * `path[0]`만 보면 안 된다 — 2단계 아래 갈래를 놓친다. 처음에 그렇게 뒀더니
     * 2,948개 중 24개만 걸렀는데, 실제 갈래는 그보다 훨씬 많다.
     */
    if (parents.has(menu.label)) {
      bump("갈래라서 뺌");
      continue;
    }

    const envelope = makeEnvelope({
      menuId: menu.id,
      label: menu.label,
      terms: overrides[menu.id]?.synonyms ?? [],
      hint: ai[menu.id]?.hint,
      path: menu.path ?? [],
    });

    if (!envelope.usable) {
      bump(envelope.reason ?? "알 수 없음");
      continue;
    }
    usable.push({ site, menu, envelope });
  }

  tally.set("쓸 수 있음", (tally.get("쓸 수 있음") ?? 0) + usable.length);

  /*
   * 넉넉히 뽑은 뒤 닮은 것을 걷어내고 자른다. 걷어낸 뒤에 뽑으면 사이트당 수가
   * 들쭉날쭉해지고, 뽑은 뒤에만 걷어내면 요청한 수보다 적게 남는다.
   */
  const wide = pickEvenly(usable, perSite * 2);
  const kept = dropNearDuplicates(wide.map((item) => item.envelope.description ?? ""));
  const deduped = kept.map((index) => wide[index]!);
  tally.set("닮아서 뺌", (tally.get("닮아서 뺌") ?? 0) + (wide.length - deduped.length));

  picked.push(...deduped.slice(0, perSite));
}

// ── 문항지 (참가자가 본다) ──────────────────────────────────────────────

const SITE_NAMES: Record<string, string> = {
  kbstar: "은행 앱",
  shinhan: "은행 앱",
  kbsec: "증권 앱",
  miraeasset: "증권 앱",
  kebhana: "은행 앱",
};

const sheet: string[] = [
  "# 이런 걸 하려면 뭐라고 말하시겠어요?",
  "",
  "휴대폰 은행·증권 앱에 **말로 시키는 기능**을 만들고 있습니다.",
  "아래는 앱 안에 있는 화면들이고, **각 화면이 하는 일**만 적어 뒀습니다.",
  "",
  "각 항목마다 **평소 쓰시는 말로** 한 줄씩 적어 주세요.",
  "",
  "- 정답은 없습니다. 앱에서 그 일을 하려고 할 때 **입 밖으로 나올 말** 그대로가 좋습니다",
  "- 예의 차린 말투나 정확한 용어로 다듬지 마세요 — 평소 말이 그대로 필요합니다",
  "- 떠오르는 게 없으면 비워 두셔도 됩니다",
  "- **시간은 20~30분** 정도 걸립니다",
  "",
  "---",
  "",
];

picked.forEach((item, index) => {
  const where = item.envelope.context?.length ? ` · ${item.envelope.context.join(" > ")}` : "";
  sheet.push(`### ${index + 1}. ${SITE_NAMES[item.site] ?? "금융 앱"}${where}`);
  sheet.push("");
  sheet.push(`이 화면에서 할 수 있는 일: **${item.envelope.description}**`);
  sheet.push("");
  sheet.push("뭐라고 말하시겠어요?");
  sheet.push("");
  sheet.push("> ");
  sheet.push("");
});

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "eval-prompts.md"), sheet.join("\n"), "utf8");

// ── 정답지 (참가자에게 보이면 안 된다) ────────────────────────────────────

const key = picked.map((item, index) => ({
  no: index + 1,
  site: item.site,
  menuId: item.menu.id,
  expect: item.menu.label,
  shown: item.envelope.description,
}));
writeFileSync(join(OUT, "eval-answer-key.json"), JSON.stringify(key, null, 2), "utf8");

// ── 요약 ────────────────────────────────────────────────────────────────

console.log(`
  제3자 문항지 — 정답의 글자를 가린 봉투 (M11 Task 13)
  ${"─".repeat(64)}

  왜: report:contamination이 "깨끗한 질의 75건 중 1건"이라고 답했다.
      그 크기로는 신경망이 이겼는지 말할 수 없다.
`);

console.log(`  거른 사유 (전체 ${SITES.length}개 사이트, 메뉴 2,948개 기준)`);
for (const [reason, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${reason.padEnd(26)} ${String(n).padStart(5)}개`);
}

console.log(`
  뽑은 문항   사이트당 ${perSite}개 × ${SITES.length} = ${picked.length}개

  문항지   tools/out/eval-prompts.md        ← 이것만 사람에게 준다
  정답지   tools/out/eval-answer-key.json   ← 저장소에 안 들어간다 (gitignore)

  ${"─".repeat(64)}
  다음: 3~5명에게 문항지를 돌리고 답을 받는다. 받은 뒤
        pnpm --filter tools report:contamination 으로 다시 걸러
        통과한 것만 fixtures/neural-queries.json에 굳힌다.

  주의: 이 세트는 **라벨과 뜻풀이의 글자가 겹치지 않는 메뉴**만 담는다.
        겨냥한 편향이지만(사용자가 라벨의 말을 안 쓰는 화면), 그래서 결과를
        "전체 메뉴에서의 성능"으로 읽으면 안 된다.
`);
