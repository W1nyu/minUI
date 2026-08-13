import type { MenuCatalog, MenuItem } from "./types.js";

/**
 * 메뉴 목록을 "상위메뉴 - 하위메뉴"로 묶는다.
 *
 * <p>실제 금융사의 메뉴는 수백 개고 이름이 서로 닮았다. `펀드검색`·`펀드매매`·`펀드잔고`가
 * 평평한 목록으로 나오면 사용자는 세 개를 하나씩 읽어 비교해야 하는데, 셋이 `펀드` 아래
 * 묶여 있으면 <b>묶음 하나만 읽고</b> 그 안에서 고른다. 검색 결과에서 특히 그렇다 —
 * "펀드"로 40개가 나올 때 평평한 40줄과 묶인 6묶음은 읽는 일의 크기가 다르다.
 *
 * <p>엔진의 랭킹·검색은 이 함수를 쓰지 않는다. 순전히 <b>보여 주는 방식</b>이며,
 * 계층 정보(`MenuItem#path`)가 없는 호스트에서는 묶음이 하나로 나온다.
 */
export interface MenuGroup {
  /** 묶음 이름. 상위 메뉴 이름을 `>`로 이은 것. 최상위 메뉴들은 빈 문자열. */
  heading: string;
  /** 이 묶음의 상위 메뉴 자체. 그것이 실제 메뉴로도 존재할 때만 채워진다. */
  parent?: MenuItem;
  menus: MenuItem[];
}

/** 이 메뉴에 이르는 전체 경로. 묶음 이름과 맞춰 보기 위한 키다. */
function fullPath(menu: MenuItem): string {
  return [...(menu.path ?? []), menu.label].join(">");
}

/**
 * @param menus 묶을 대상. 검색 결과처럼 카탈로그의 일부일 수 있다.
 * @param catalog 상위 메뉴를 찾을 곳. 생략하면 `menus` 안에서만 찾는다 —
 *   검색 결과에는 상위 메뉴가 안 들어 있을 수 있으므로 전체 카탈로그를 넘기는 편이 낫다.
 */
export function groupByPath(
  menus: readonly MenuItem[],
  catalog: MenuCatalog = menus,
): MenuGroup[] {
  const parents = new Map<string, MenuItem>();
  for (const menu of catalog) {
    const key = fullPath(menu);
    // 같은 경로가 둘이면 먼저 온 것을 쓴다. 카탈로그 순서가 사이트의 메뉴 순서다.
    if (!parents.has(key)) parents.set(key, menu);
  }

  const groups = new Map<string, MenuGroup>();
  for (const menu of menus) {
    // 상위 메뉴 자신은 자기 부모의 묶음에 들어간다. `이체`가 `이체` 묶음의 머리가 되면
    // 그것을 눌러서 열 길이 사라진다 — 갈래도 실제 화면일 수 있다(KB `계좌이체`).
    const heading = (menu.path ?? []).join(">");
    let group = groups.get(heading);
    if (!group) {
      const parent = parents.get(heading);
      group = { heading, ...(parent ? { parent } : {}), menus: [] };
      groups.set(heading, group);
    }
    group.menus.push(menu);
  }

  return [...groups.values()];
}

/** 묶음 이름을 화면에 쓸 문자열로. `>`를 사람이 읽는 구분자로 바꾼다. */
export function headingText(heading: string): string {
  return heading.split(">").filter(Boolean).join(" › ");
}
