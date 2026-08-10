import type { MenuId } from "@minui/core";
import { useMemo, useState } from "react";
import type { SiteMeta } from "./sites.js";

/**
 * 원래 메뉴 — 대조군.
 *
 * <p>사이트가 만든 카테고리 계층을 그대로 펼친다. 카드 홈과 비교했을 때 무엇이 다른지
 * 보려면 대조군이 실제 사이트를 닮아야 한다. 일부러 나쁘게 만들면 비교가 의미를 잃는다.
 *
 * <p>여기서 드러나는 것이 하나 있다 — 실제 금융사의 메뉴 수는 수백에서 천 개를 넘는다.
 * 카테고리를 접어 두어도 한 갈래를 펼치면 수십 개가 쏟아진다.
 */
export function ClassicShell({
  site,
  onOpen,
}: {
  site: SiteMeta;
  onOpen: (menuId: MenuId) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byCategory = new Map<string, typeof site.catalog>();
    for (const menu of site.catalog) {
      const list = byCategory.get(menu.category) ?? [];
      byCategory.set(menu.category, [...list, menu]);
    }
    return [...byCategory.entries()];
  }, [site.catalog]);

  return (
    <div className="classic">
      <p className="classic-note">
        {site.name}의 메뉴 체계를 그대로 펼친 화면입니다. 카테고리 {groups.length}개,
        메뉴 {site.catalog.length.toLocaleString()}개.
      </p>

      {groups.map(([category, menus]) => {
        const expanded = open === category;
        return (
          <section className="classic-group" key={category}>
            <h2>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : category)}
              >
                <span>{category}</span>
                <span className="classic-count">{menus.length}</span>
              </button>
            </h2>
            {expanded && (
              <ul>
                {menus.map((menu) => (
                  <li key={menu.id}>
                    <button type="button" onClick={() => onOpen(menu.id)}>
                      {menu.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
