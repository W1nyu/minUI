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
    this.menus = catalog.map((menu) => ({
      menuId: menu.id,
      terms: dedupe([
        normalize(menu.label),
        ...(menu.synonyms ?? []).map(normalize),
      ]).filter((term) => term.length > 0),
      category: normalize(menu.category),
      categoryLabel: menu.category,
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
