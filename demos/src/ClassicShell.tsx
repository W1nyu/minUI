import { groupByPath, headingText } from "@minui/core";
import { useMinUI } from "@minui/react";
import { useId, useMemo, useState } from "react";
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

/** 띄어쓰기·기호를 무시하고 비교한다. "계좌 이체"로 "계좌이체"를 찾을 수 있게. */
function squash(value: string): string {
  return value.replace(/[\s/·]+/g, "").toLowerCase();
}

export function ClassicShell({ site }: { site: SiteMeta }) {
  /*
   * 여기서 연 메뉴도 엔진을 거친다.
   *
   * 호스트의 onAction을 직접 부르면 화면은 똑같이 열리지만 기록이 남지 않는다. 그러면
   * 원래 메뉴로 자주 쓰는 기능이 쉬운 모드의 카드에 영영 올라오지 않는다 — 사용자가
   * 어느 화면에서 눌렀는지는 그가 무엇을 자주 쓰는지와 아무 상관이 없다.
   */
  const { open: openMenu } = useMinUI();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchId = useId();

  const groups = useMemo(() => {
    const byCategory = new Map<string, typeof site.catalog>();
    for (const menu of site.catalog) {
      const list = byCategory.get(menu.category) ?? [];
      byCategory.set(menu.category, [...list, menu]);
    }
    return [...byCategory.entries()];
  }, [site.catalog]);

  /*
   * 대조군의 검색은 **글자 그대로 찾는다.** 엔진의 SearchPipeline을 쓰지 않는다.
   *
   * 실제 금융사 사이트의 메뉴 검색이 그렇게 동작하기 때문이다 — 메뉴 이름에 그 글자가
   * 있으면 나오고 없으면 안 나온다. 여기에 엔진을 붙이면 대조군이 대조군이 아니게 되고,
   * "쉬운 모드가 무엇을 더 해 주는가"라는 질문 자체가 사라진다.
   * 그래서 "잔액"으로는 계좌조회가 안 나온다. 그 차이가 측정 대상이다.
   */
  const hits = useMemo(() => {
    const needle = squash(query);
    if (needle.length === 0) return null;
    return site.catalog.filter((menu) => squash(menu.label).includes(needle));
  }, [query, site.catalog]);

  return (
    <div className="classic">
      <div className="classic-search">
        <label htmlFor={searchId}>메뉴 검색</label>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="메뉴 이름을 입력하세요"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {hits !== null ? (
        <section className="classic-hits" aria-live="polite">
          <p className="classic-note">
            {hits.length === 0
              ? `'${query}'가 들어간 메뉴가 없습니다.`
              : `'${query}' — ${hits.length.toLocaleString()}개`}
          </p>
          {/* 결과를 상위메뉴로 묶는다. 40줄이 6묶음이 되면 읽는 일의 크기가 달라진다. */}
          {groupByPath(hits.slice(0, 60), site.catalog).map((group) => (
            <div className="classic-hit-group" key={group.heading}>
              {group.heading !== "" && (
                <p className="classic-hit-head">{headingText(group.heading)}</p>
              )}
              <ul>
                {group.menus.map((menu) => (
                  <li key={menu.id}>
                    <button type="button" onClick={() => openMenu(menu.id)}>
                      {menu.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {hits.length > 60 && (
            <p className="classic-note">앞의 60개만 보여 줍니다. 더 좁혀 보세요.</p>
          )}
        </section>
      ) : (
        groups.map(([category, menus]) => {
          const expanded = expandedGroup === category;
          return (
            <section className="classic-group" key={category}>
              <h2>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedGroup(expanded ? null : category)}
                >
                  <span>{category}</span>
                  <span className="classic-count">{menus.length}</span>
                </button>
              </h2>
              {expanded &&
                groupByPath(menus, site.catalog).map((group) => (
                  <div className="classic-subgroup" key={group.heading}>
                    {group.heading !== "" && (
                      <p className="classic-hit-head">{headingText(group.heading)}</p>
                    )}
                    <ul>
                      {group.menus.map((menu) => (
                        <li key={menu.id}>
                          <button type="button" onClick={() => openMenu(menu.id)}>
                            {menu.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </section>
          );
        })
      )}
    </div>
  );
}
