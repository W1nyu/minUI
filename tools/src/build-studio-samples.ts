import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { harvest, siteNameFrom } from "../../services/harvester/src/harvest.js";
import type { StudioResult } from "../../shared/host-ai/studio.js";
import { buildMenus } from "./build-catalog.js";
import { firstCards } from "./presets.js";

/**
 * Studio가 배포에서 **재생할 결과를 미리 굽는다.**
 *
 * <p>여기서 하는 일은 `demos/src/studioRoute.ts`가 요청마다 하던 것과 <b>같은 순서·같은
 * 함수</b>다. 다른 것은 시점뿐이다 — 심사위원이 누를 때가 아니라 지금 한 번 긁는다.
 * 조립이 `buildMenus`(CLI와 같은 함수)를 거치므로 재생되는 수치도 실측이다.
 *
 * <p>이 스크립트는 <b>Chrome이 있는 로컬에서만</b> 돈다. 그것이 요점이다 — 배포 이미지에서
 * Playwright를 빼기 위해 여기서 대신 치른다.
 *
 * <p>`pnpm --filter tools build:studio-samples`
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "../../shared/host-ai/studio-samples");

/** `shared/host-ai/studio.ts`의 `SAMPLES` 목록과 같아야 한다. */
const TARGETS = [
  { site: "kebhana", url: "https://www.kebhana.com/" },
  { site: "shinhan", url: "https://www.shinhan.com/index.jsp" },
  { site: "kbsec", url: "https://www.kbsec.com/go.able" },
] as const;

mkdirSync(OUT_DIR, { recursive: true });

for (const target of TARGETS) {
  console.log(`\n  ${target.site} — ${target.url}`);
  const steps: StudioResult["steps"] = [];
  const mark = (name: string, detail: string, from: number) => {
    const ms = Date.now() - from;
    steps.push({ name, detail, ms });
    console.log(`    ${name.padEnd(6)} ${detail} (${(ms / 1000).toFixed(1)}초)`);
  };

  try {
    let at = Date.now();
    const harvested = await harvest({ url: target.url, timeoutMs: 40_000 });
    mark("수집", `메뉴 후보 ${harvested.items.length}개`, at);

    at = Date.now();
    const site = siteNameFrom(harvested.source.host);
    const built = buildMenus(site, { source: harvested.source, items: harvested.items });
    mark("정리", `메뉴 ${built.menus.length}개`, at);

    at = Date.now();
    const presets = firstCards(built.menus);
    mark("첫 화면", "카탈로그 앞 넉 장으로 시작합니다", at);

    const result: StudioResult = {
      site,
      host: harvested.source.host,
      catalog: built.menus,
      presets,
      steps,
      problems: built.problems,
      stats: {
        harvested: harvested.items.length,
        menus: built.menus.length,
        branches: built.stats.branches,
        duplicateLabels: built.stats.duplicateLabels,
        highRisk: built.stats.highRisk,
        codedIds: harvested.items.filter((item) => !item.key.startsWith("label:")).length,
      },
    };

    // 파일 이름은 `site`가 아니라 target.site를 쓴다. 수집기가 붙이는 이름과
    // 재생기가 찾는 이름이 갈리면 배포에서 조용히 못 찾는다.
    const out = join(OUT_DIR, `${target.site}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`    → ${out}`);
    if (site !== target.site) {
      console.log(`    주의: 수집기가 붙인 이름은 "${site}"입니다 (파일은 ${target.site}.json).`);
    }
  } catch (error) {
    console.error(`    실패: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`    이 사이트는 건너뜁니다 — 나머지는 계속합니다.`);
  }
}

console.log("");
