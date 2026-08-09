import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MinUIEngine } from "../src/MinUIEngine.js";
import { MemoryStorageAdapter } from "../src/storage/MemoryStorageAdapter.js";
import type { PartialConfig } from "../src/config.js";
import type {
  ColdStartPresets,
  ColdStartProfile,
  MenuCatalog,
  MenuId,
} from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

interface Usage {
  menuId: MenuId;
  times?: number;
  completed?: boolean;
  everyHours?: number;
}

interface Session {
  at: string;
  note?: string;
  expectCards?: MenuId[];
  expectNewBadges?: MenuId[];
  maxChangesFromPrevious?: number;
  use?: Usage[];
}

interface Scenario {
  name: string;
  config?: PartialConfig;
  profile?: ColdStartProfile;
  presets?: ColdStartPresets;
  sessions: Session[];
}

const CATALOG = JSON.parse(
  readFileSync(join(FIXTURES, "menus.json"), "utf8"),
) as MenuCatalog;

const scenarioFiles = readdirSync(FIXTURES).filter(
  (f) => f.endsWith(".json") && f !== "menus.json",
);

/**
 * 픽스처는 엔진 동작의 언어 중립 명세다 (fixtures/README.md).
 * 여기 있는 기대값은 TypeScript 구현이 아니라 기획안 §8.2의 규칙에서 나온 것이며,
 * 다른 언어로 포팅할 때 같은 파일로 동등성을 확인한다.
 */
describe.each(scenarioFiles)("픽스처: %s", (file) => {
  const scenario = JSON.parse(
    readFileSync(join(FIXTURES, file), "utf8"),
  ) as Scenario;

  it(scenario.name, async () => {
    const storage = new MemoryStorageAdapter();
    let previous: MenuId[] | null = null;

    for (const [index, session] of scenario.sessions.entries()) {
      const start = Date.parse(session.at);
      expect(Number.isNaN(start), `세션 ${index}의 at 형식이 잘못됨`).toBe(false);

      let now = start;
      const engine = await MinUIEngine.create({
        catalog: CATALOG,
        onAction: () => {},
        storage,
        now: () => now,
        ...(scenario.config ? { config: scenario.config } : {}),
        ...(scenario.presets ? { coldStartPresets: scenario.presets } : {}),
      });

      if (scenario.profile && index === 0) {
        await engine.setProfile(scenario.profile);
      }

      const cards = engine.getCards();
      const ids = cards.map((c) => c.menuId);
      const where = `${file} 세션 ${index} (${session.at})`;

      if (session.expectCards) {
        expect(ids, `${where}: 카드 구성`).toEqual(session.expectCards);
      }

      if (session.expectNewBadges) {
        const badged = cards.filter((c) => c.isNew).map((c) => c.menuId);
        expect(badged.sort(), `${where}: 새로 추가됨 배지`).toEqual(
          [...session.expectNewBadges].sort(),
        );
      }

      if (session.maxChangesFromPrevious !== undefined && previous) {
        const changed = ids.filter((id) => !previous!.includes(id));
        expect(
          changed.length,
          `${where}: 직전 세션 대비 바뀐 카드 ${JSON.stringify(changed)}`,
        ).toBeLessThanOrEqual(session.maxChangesFromPrevious);
      }

      for (const usage of session.use ?? []) {
        const times = usage.times ?? 1;
        const stepMs = (usage.everyHours ?? 1) * 3600_000;
        for (let i = 0; i < times; i++) {
          now = start + i * stepMs;
          engine.open(usage.menuId);
          if (usage.completed !== false) engine.complete(usage.menuId);
        }
      }

      previous = ids;
      await engine.close();
    }
  });
});
