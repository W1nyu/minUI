import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDrift, type Provenance } from "../src/provenance.js";

/**
 * **수집이 조용히 깨지는 것을 막는 장치**를 잰다.
 *
 * <p>가장 나쁜 실패는 화면이 멀쩡한 실패다. 수집이 절반만 성공해 메뉴 930개가 40개가 돼도
 * 데모는 뜨고, 검색만 조용히 나빠진다. 아무도 모른 채 시연에 들고 간다.
 *
 * <p>그래서 재는 것은 "기록이 있는가"가 아니라 <b>"급변이 실제로 막히는가"</b>다.
 * 기록만 있고 비교가 없으면 아무도 안 읽는 파일이 하나 늘 뿐이다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGS = join(HERE, "../../demos/src/catalogs");

const NOW = new Date("2026-08-27T00:00:00.000Z");

function site(menus: number, capturedAt = "2026-08-10T00:00:00.000Z") {
  return { host: "example.com", capturedAt, menus, rawItems: menus + 10, orphans: 0, remaps: 0 };
}

const at = (sites: Provenance["sites"]): Provenance => ({ builtAt: NOW.toISOString(), sites });

describe("수집이 급변하면 막는다", () => {
  it("처음 기록할 때는 비교할 것이 없으니 통과한다", () => {
    // 여기서 막으면 새 사이트를 아예 추가할 수 없다.
    const drift = checkDrift(undefined, at({ shinhan: site(930) }), NOW);
    expect(drift.failures).toEqual([]);
  });

  it("메뉴가 반토막 나면 실패시킨다", () => {
    const drift = checkDrift(at({ shinhan: site(930) }), at({ shinhan: site(400) }), NOW);
    expect(drift.failures).toHaveLength(1);
    // 실패는 무엇을 확인해야 하는지 말해야 한다.
    expect(drift.failures[0]).toMatch(/930.*400/);
    expect(drift.failures[0]).toMatch(/로그인|렌더링|선택자/);
  });

  it("조금 줄어든 것은 막지 않는다", () => {
    // 사이트가 메뉴 몇 개를 손보는 것은 늘 있는 일이다. 그때마다 빌드가 서면 아무도 안 본다.
    const drift = checkDrift(at({ shinhan: site(930) }), at({ shinhan: site(880) }), NOW);
    expect(drift.failures).toEqual([]);
  });

  it("늘어난 것은 막지 않는다", () => {
    const drift = checkDrift(at({ shinhan: site(930) }), at({ shinhan: site(1_500) }), NOW);
    expect(drift.failures).toEqual([]);
  });

  it("사이트가 통째로 사라지면 실패시킨다", () => {
    const drift = checkDrift(at({ shinhan: site(930), kbsec: site(642) }), at({ shinhan: site(930) }), NOW);
    expect(drift.failures).toHaveLength(1);
    expect(drift.failures[0]).toMatch(/kbsec/);
  });

  it("붙지 못한 override는 경고하되 막지는 않는다", () => {
    // 사람이 봐야 하는 일이지만, 빌드를 세울 만큼은 아니다.
    const next = at({ shinhan: { ...site(930), orphans: 3 } });
    const drift = checkDrift(at({ shinhan: site(930) }), next, NOW);
    expect(drift.failures).toEqual([]);
    expect(drift.warnings.some((w) => /override 3건/.test(w))).toBe(true);
  });

  it("수집이 오래되면 경고한다", () => {
    const next = at({ shinhan: site(930, "2025-01-01T00:00:00.000Z") });
    const drift = checkDrift(undefined, next, NOW);
    expect(drift.warnings.some((w) => /최신 메뉴/.test(w))).toBe(true);
  });

  it("읽을 수 없는 수집 시각은 실패시킨다", () => {
    // 날짜가 깨진 기록은 "언제 왔는지 안다"는 주장 자체를 무너뜨린다.
    const next = at({ shinhan: site(930, "언젠가") });
    const drift = checkDrift(undefined, next, NOW);
    expect(drift.failures.some((f) => /capturedAt/.test(f))).toBe(true);
  });
});

describe("커밋된 기록이 커밋된 카탈로그와 맞는다", () => {
  const provenance = JSON.parse(
    readFileSync(join(CATALOGS, "provenance.json"), "utf8"),
  ) as Provenance;

  /*
   * 이 묶음이 잡으려는 것은 **기록과 카탈로그가 따로 노는 상태**다. 카탈로그만 다시
   * 굽고 기록을 안 올리면, 다음 빌드는 낡은 기준과 견주게 되고 급변 감시가 헛돈다.
   */
  it("다섯 곳이 모두 기록에 있다", () => {
    expect(Object.keys(provenance.sites).sort()).toEqual(
      ["kbsec", "kbstar", "kebhana", "miraeasset", "shinhan"].sort(),
    );
  });

  for (const [name, meta] of Object.entries(provenance.sites)) {
    it(`${name}: 기록한 메뉴 수가 실제 파일과 같다`, () => {
      const menus = JSON.parse(readFileSync(join(CATALOGS, `${name}.json`), "utf8")) as unknown[];
      expect(menus.length, `기록 ${meta.menus} ≠ 실제 ${menus.length} — 기록을 함께 커밋했는지`).toBe(
        meta.menus,
      );
    });

    it(`${name}: 언제 어디서 왔는지 말할 수 있다`, () => {
      expect(meta.host).toMatch(/\./);
      expect(Number.isNaN(new Date(meta.capturedAt).getTime())).toBe(false);
    });
  }
});
