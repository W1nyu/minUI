import type { MenuCatalog, MenuId } from "../types.js";
import { normalize } from "./normalize.js";

/** 메뉴 하나가 가진, 검색에 걸릴 수 있는 표현들. */
export interface IndexedMenu {
  menuId: MenuId;
  /** 정규화된 표현들. label과 synonyms에서 온다. */
  terms: string[];
  /** 정규화된 카테고리. 되묻기 선택지를 만들 때 쓴다. */
  category: string;
  /** 원본 카테고리 — 사용자에게 보여줄 때 쓴다. */
  categoryLabel: string;
  /**
   * 갈래. **되묻기 선택지를 가를 때 쓴다** (M11).
   *
   * <p>점수에는 관여하지 않는다 — `category`와 마찬가지로 검색 term이 아니다.
   * 카탈로그가 안 주면 빈 배열이고, 그때는 되묻기가 지금까지처럼 카테고리로 떨어진다.
   */
  path: readonly string[];
  /**
   * 이 메뉴 아래에 다른 메뉴가 있는가.
   *
   * <p>점수에는 관여하지 않는다. <b>동점을 깰 때만</b> 쓴다 — 자식이 있는 항목은
   * 목적지이기도 하지만 이름표이기도 해서, 같은 점수라면 자식 쪽이 사용자가 가려던 곳일
   * 가능성이 높다.
   */
  hasChildren: boolean;
}

/**
 * 카탈로그를 검색 가능한 형태로 펼친 것.
 *
 * 카테고리를 term에 넣지 않는 이유: "조회"가 조회 카테고리 다섯 메뉴에 모두 붙으면
 * "조회해줘" 한마디가 다섯 개를 동점으로 만든다. 카테고리는 되묻기 선택지를
 * 만드는 데만 쓰고, 매칭에는 관여시키지 않는다.
 */
export class MenuIndex {
  readonly menus: readonly IndexedMenu[];

  constructor(catalog: MenuCatalog) {
    // 누군가의 부모인 경로들. 자식의 path가 [부모의 path, 부모의 label]이다.
    const parents = new Set(
      catalog.map((menu) => (menu.path ?? []).join(">")).filter((path) => path.length > 0),
    );

    this.menus = catalog.map((menu) => ({
      menuId: menu.id,
      terms: dedupe([
        normalize(menu.label),
        ...(menu.synonyms ?? []).map(normalize),
      ]).filter((term) => term.length > 0),
      category: normalize(menu.category),
      categoryLabel: menu.category,
      path: menu.path ?? [],
      hasChildren: parents.has([...(menu.path ?? []), menu.label].join(">")),
    }));
  }

  /** 카탈로그에 나온 순서를 지킨 카테고리 목록. 되묻기 선택지에 쓴다. */
  categories(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const menu of this.menus) {
      if (seen.has(menu.categoryLabel)) continue;
      seen.add(menu.categoryLabel);
      out.push(menu.categoryLabel);
    }
    return out;
  }

  /** n-gram 색인에 넣을 문서. 표현들을 구분자로 이어 붙인다. */
  documents(): { menuId: MenuId; terms: string[] }[] {
    return this.menus.map((menu) => ({ menuId: menu.menuId, terms: menu.terms }));
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
