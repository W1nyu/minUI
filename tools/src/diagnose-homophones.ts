import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize, pronounce, type MenuCatalog } from "@minui/core";

/**
 * 발음 표기가 만들어 내는 충돌을 센다 (M21).
 *
 * <p><b>왜 재는가.</b> 소리로 맞추면 회수가 늘지만 <b>서로 다른 메뉴가 같은 소리가 되는</b>
 * 대가가 따라온다. 늘어난 회수만 세고 이 대가를 안 세면 §16이 기록한 실패들과 같은 실수다.
 * 여기서 세는 것은 "얼마나 좋아졌나"가 아니라 <b>"무엇을 잃을 수 있나"</b>이다.
 *
 * <p>충돌에는 두 종류가 있고 값이 다르다.
 *
 * <ul>
 *   <li><b>글자도 같은 것</b> — 원래부터 같은 이름이다. 발음 표기가 만든 문제가 아니다.
 *   <li><b>글자는 다른데 소리가 같아진 것</b> — 이 단계가 <b>새로 만든</b> 충돌이다.
 *       이것만이 이 진단의 대상이다.
 * </ul>
 *
 * <pre>
 *   pnpm --filter tools diagnose:homophones
 * </pre>
 */

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = join(here, "../../demos/src/catalogs");

interface Term {
  site: string;
  menuId: string;
  label: string;
  /** 정규화된 표현. 글자 쪽. */
  text: string;
}

function loadTerms(): Term[] {
  const terms: Term[] = [];

  for (const file of readdirSync(CATALOG_DIR)) {
    if (!file.endsWith(".json") || file === "provenance.json") continue;
    const site = file.replace(/\.json$/u, "");
    const catalog = JSON.parse(readFileSync(join(CATALOG_DIR, file), "utf8")) as MenuCatalog;

    for (const menu of catalog) {
      // 라벨만 본다. 동의어는 원래 여러 메뉴에 겹쳐 붙으므로 충돌 진단의 신호가 아니다.
      const text = normalize(menu.label);
      if (text.length === 0) continue;
      terms.push({ site, menuId: menu.id, label: menu.label, text });
    }
  }

  return terms;
}

function main(): void {
  const terms = loadTerms();

  let changed = 0;
  const bySound = new Map<string, Term[]>();

  for (const term of terms) {
    const sound = pronounce(term.text);
    if (sound !== term.text) changed += 1;
    const bucket = bySound.get(sound);
    if (bucket) bucket.push(term);
    else bySound.set(sound, [term]);
  }

  /*
   * **같은 사이트 안에서만 센다.** 검색은 한 번에 카탈로그 하나만 본다 —
   * 신한의 메뉴와 하나은행의 메뉴가 같은 소리인 것은 아무 데서도 부딪히지 않는다.
   */
  let newCollisions = 0;
  let alreadySame = 0;
  const examples: string[] = [];

  for (const bucket of bySound.values()) {
    if (bucket.length < 2) continue;

    const sites = new Set(bucket.map((term) => term.site));
    for (const site of sites) {
      const here = bucket.filter((term) => term.site === site);
      if (here.length < 2) continue;

      const spellings = new Set(here.map((term) => term.text));
      if (spellings.size === 1) {
        alreadySame += here.length - 1;
        continue;
      }

      newCollisions += here.length - 1;
      if (examples.length < 30) {
        examples.push(
          `  ${site.padEnd(11)} ${pronounce(here[0]!.text).padEnd(18)} ← ` +
            here.map((term) => term.label).join(" · "),
        );
      }
    }
  }

  const pct = (n: number) => `${((100 * n) / terms.length).toFixed(1)}%`;

  console.log("\n── 발음 표기가 만드는 충돌 (M21) ─────────────────────────────\n");
  console.log(`  라벨 ${terms.length}개 · 사이트 ${new Set(terms.map((t) => t.site)).size}곳`);
  console.log(`  소리가 글자와 달라지는 라벨      ${changed}  ${pct(changed)}`);
  console.log(`  원래부터 이름이 같던 것           ${alreadySame}  ${pct(alreadySame)}   ← 이 단계와 무관`);
  console.log(`  소리가 같아져 새로 겹친 것        ${newCollisions}  ${pct(newCollisions)}   ← 이 단계가 만든 대가`);

  if (examples.length > 0) {
    console.log("\n  새로 겹친 것 (최대 30):");
    console.log(examples.join("\n"));
  } else {
    console.log("\n  새로 겹친 것 없음.");
  }

  console.log(
    "\n  읽는 법: 새로 겹친 쌍은 `phonetic` 단계에서 동점이 된다. `exact`가 아니므로\n" +
      "  DECISIVE 필터를 가로채지는 않고, 글자로 맞는 후보가 있으면 그쪽이 이긴다.\n",
  );
}

main();
