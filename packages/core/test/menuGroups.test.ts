import { describe, expect, it } from "vitest";
import { groupByPath, headingText } from "../src/menuGroups.js";
import type { MenuItem } from "../src/types.js";

function menu(id: string, label: string, path?: string[]): MenuItem {
  return {
    id,
    label,
    category: path?.[0] ?? label,
    ...(path ? { path } : {}),
    icon: "doc",
    route: `/${id}`,
    riskLevel: "low",
  };
}

const CATALOG: MenuItem[] = [
  menu("m.이체", "이체", ["뱅킹"]),
  menu("m.간편이체", "간편이체", ["뱅킹", "이체"]),
  menu("m.자동이체", "자동이체", ["뱅킹", "이체"]),
  menu("m.펀드", "펀드", ["상품"]),
  menu("m.펀드검색", "펀드검색", ["상품", "펀드"]),
];

describe("상위메뉴로 묶기", () => {
  it("하위메뉴가 상위메뉴 아래로 묶인다", () => {
    const groups = groupByPath(CATALOG);

    expect(groups.map((g) => [g.heading, g.parent?.label, g.menus.map((m) => m.label)])).toEqual([
      ["뱅킹", undefined, ["이체"]],
      ["뱅킹>이체", "이체", ["간편이체", "자동이체"]],
      ["상품", undefined, ["펀드"]],
      ["상품>펀드", "펀드", ["펀드검색"]],
    ]);
  });

  it("상위메뉴 자신은 머리가 아니라 자기 부모의 줄로 들어간다 — 눌러서 열 수 있어야 하므로", () => {
    const groups = groupByPath(CATALOG);
    const banking = groups.find((g) => g.heading === "뱅킹")!;

    expect(banking.menus.map((m) => m.id)).toContain("m.이체");
  });

  it("검색 결과처럼 일부만 넘겨도 상위메뉴 이름을 카탈로그에서 찾는다", () => {
    const hits = CATALOG.filter((m) => m.label.includes("이체") && m.label !== "이체");
    const groups = groupByPath(hits, CATALOG);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.parent?.label).toBe("이체");
    expect(groups[0]?.menus.map((m) => m.label)).toEqual(["간편이체", "자동이체"]);
  });

  it("계층이 없는 호스트에서는 묶음이 하나다", () => {
    const flat = [menu("a", "가"), menu("b", "나")];

    const groups = groupByPath(flat);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.heading).toBe("");
    expect(groups[0]?.parent).toBeUndefined();
  });

  it("묶음 이름은 사람이 읽는 구분자로 바꾼다", () => {
    expect(headingText("뱅킹>이체")).toBe("뱅킹 › 이체");
    expect(headingText("")).toBe("");
  });
});
