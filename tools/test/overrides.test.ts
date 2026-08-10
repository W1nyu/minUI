import type { MenuItem } from "@minui/core";
import { describe, expect, it } from "vitest";
import { attachOverrides, type Override } from "../src/overrides.js";

/**
 * 사이트 개편에서 살아남는가.
 *
 * <p>신한은행과 미래에셋은 사이트가 메뉴 코드를 주지 않는다 — 로그인 후에도 없는 것을
 * 확인했다. 그래서 id를 라벨 경로로 만들 수밖에 없고, 사이트가 문구를 바꾸면 id가 끊어진다.
 * 손으로 붙인 동의어가 그때 통째로 죽으면 이 작업 방식 자체가 성립하지 않는다.
 *
 * <p>여기서 재현하는 것은 그 상황이다.
 */

function menu(id: string, label: string, category = "이체"): MenuItem {
  return {
    id,
    label,
    synonyms: [],
    category,
    icon: "doc",
    route: `/${id}`,
    riskLevel: "low",
  };
}

const HAND_WORK: Override = {
  synonyms: ["떼가는 거 그만", "자동이체 해지", "매달 나가는 돈"],
  riskLevel: "high",
  icon: "repeat",
};

describe("id가 살아 있을 때", () => {
  it("정확히 일치하면 그대로 붙는다", () => {
    const menus = [menu("shinhan.개인-이체-자동이체-조회-변경-취소", "자동이체 조회/변경/취소")];
    const { resolved, remaps, orphans } = attachOverrides(menus, {
      "shinhan.개인-이체-자동이체-조회-변경-취소": HAND_WORK,
    });

    expect(resolved.get(menus[0]!.id)?.synonyms).toEqual(HAND_WORK.synonyms);
    expect(remaps).toEqual([]);
    expect(orphans).toEqual([]);
  });

  it("주석 키(_note)는 무시한다", () => {
    const { orphans } = attachOverrides([menu("a", "가")], { _note: {} as Override });
    expect(orphans).toEqual([]);
  });
});

describe("사이트가 문구를 바꿨을 때 — 이 작업의 핵심", () => {
  it("메뉴 이름이 조금 바뀌어도 자모 유사도로 다시 붙는다", () => {
    // 사이트 개편: "조회/변경/취소" → "조회·변경·해지"
    const menus = [
      menu("shinhan.개인-이체-자동이체-조회-변경-해지", "자동이체 조회·변경·해지"),
      menu("shinhan.개인-이체-당행-다른기관이체", "당행/다른기관이체"),
    ];

    const { resolved, remaps, orphans } = attachOverrides(menus, {
      "shinhan.개인-이체-자동이체-조회-변경-취소": HAND_WORK,
    });

    expect(orphans).toEqual([]);
    expect(resolved.get("shinhan.개인-이체-자동이체-조회-변경-해지")?.synonyms).toEqual(
      HAND_WORK.synonyms,
    );
    // 자동으로 붙였더라도 조용히 넘어가지 않는다.
    expect(remaps).toHaveLength(1);
    expect(remaps[0]!.how).toMatch(/^자모/);
  });

  it("match.label을 주면 id와 무관하게 붙는다", () => {
    // 경로가 통째로 바뀐 경우 — 자모로도 못 잡는다.
    const menus = [menu("shinhan.뱅킹-자동이체관리", "자동이체 조회/변경/취소")];

    const { resolved, remaps } = attachOverrides(menus, {
      "shinhan.개인-이체-자동이체-조회-변경-취소": {
        ...HAND_WORK,
        match: { label: "자동이체 조회/변경/취소" },
      },
    });

    expect(resolved.get("shinhan.뱅킹-자동이체관리")?.synonyms).toEqual(HAND_WORK.synonyms);
    expect(remaps[0]!.how).toBe("match.label");
  });

  it("카테고리까지 지정하면 같은 이름의 다른 메뉴와 헷갈리지 않는다", () => {
    // 실제로 신한에는 "계좌조회"가 여러 갈래에 있다.
    const menus = [
      menu("shinhan.기업-예금-계좌조회", "계좌조회", "예금/신탁"),
      menu("shinhan.개인-조회-계좌조회", "계좌조회", "조회"),
    ];

    const { resolved } = attachOverrides(menus, {
      "shinhan.없어진-id": {
        synonyms: ["잔액 보기"],
        match: { label: "계좌조회", category: "조회" },
      },
    });

    expect(resolved.get("shinhan.개인-조회-계좌조회")?.synonyms).toEqual(["잔액 보기"]);
    expect(resolved.has("shinhan.기업-예금-계좌조회")).toBe(false);
  });
});

describe("붙이지 못할 때는 조용히 넘어가지 않는다", () => {
  it("메뉴가 사라졌으면 orphan으로 보고한다", () => {
    const menus = [menu("shinhan.개인-조회-잔액", "잔액조회", "조회")];

    const { resolved, orphans } = attachOverrides(menus, {
      "shinhan.개인-대출-금리인하요구권": HAND_WORK,
    });

    expect(resolved.size).toBe(0);
    expect(orphans).toHaveLength(1);
    // 가장 가까운 후보를 함께 알려 준다. 사람이 판단할 재료가 있어야 한다.
    expect(orphans[0]!.key).toBe("shinhan.개인-대출-금리인하요구권");
  });

  it("어설프게 비슷한 것에 함부로 붙이지 않는다", () => {
    // "자동이체 해지"용 동의어가 "자동차보험"에 붙으면 안 된다.
    const menus = [menu("shinhan.개인-보험-자동차보험", "자동차보험", "보험")];

    const { resolved, orphans } = attachOverrides(menus, {
      "shinhan.개인-이체-자동이체-조회-변경-취소": HAND_WORK,
    });

    expect(resolved.size).toBe(0);
    expect(orphans).toHaveLength(1);
  });

  it("한 메뉴에 두 override가 붙지 않는다", () => {
    const menus = [menu("shinhan.개인-이체-자동이체-조회-변경-해지", "자동이체 조회·변경·해지")];

    const { resolved, orphans } = attachOverrides(menus, {
      "shinhan.개인-이체-자동이체-조회-변경-취소": HAND_WORK,
      "shinhan.개인-이체-자동이체-조회-변경-정지": { synonyms: ["다른 것"] },
    });

    expect(resolved.size).toBe(1);
    expect(orphans).toHaveLength(1);
  });
});

describe("코드가 있는 사이트는 애초에 안 끊어진다", () => {
  it("KB국민은행처럼 page 코드를 쓰면 문구가 바뀌어도 그대로다", () => {
    // 라벨만 바뀌고 id(page 코드)는 그대로인 상황
    const menus = [menu("kbstar.C018401", "자동이체 관리(개편)")];

    const { resolved, remaps } = attachOverrides(menus, { "kbstar.C018401": HAND_WORK });

    expect(resolved.get("kbstar.C018401")?.synonyms).toEqual(HAND_WORK.synonyms);
    expect(remaps).toEqual([]);
  });
});
