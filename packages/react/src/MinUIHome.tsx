import type { MenuCatalog, MenuId } from "@minui/core";
import { useState, type ReactNode } from "react";
import { AllMenuSheet } from "./AllMenuSheet.js";
import { MenuCard } from "./MenuCard.js";
import { useMinUI } from "./useMinUI.js";

export interface MinUIHomeProps {
  catalog: MenuCatalog;
  /** 카드가 들고 있을 답. 호스트가 채운다 — 엔진은 은행 도메인을 모른다. */
  renderCardDetail?: (menuId: MenuId) => ReactNode;
  /** 카드 격자 위에 놓일 것 (인사말, 글씨 크기 조절 등). */
  header?: ReactNode;
  /** 하단 바에 추가할 것. M4에서 음성 버튼이 여기 들어온다. */
  dockExtra?: ReactNode;
}

/**
 * 카드 홈 화면.
 *
 * 이 컴포넌트가 하지 않는 일이 중요하다 — 점수를 계산하지 않고, 카드를 정렬하지 않고,
 * 무엇을 보여줄지 고르지 않는다. 전부 엔진이 이미 정한 것을 그리기만 한다.
 * 여기서 한 번이라도 정렬하면 "자리를 지킨다"는 규칙이 UI 레이어에서 깨진다.
 */
export function MinUIHome({
  catalog,
  renderCardDetail,
  header,
  dockExtra,
}: MinUIHomeProps) {
  const { cards, open } = useMinUI();
  const [showAllMenus, setShowAllMenus] = useState(false);

  const byId = new Map(catalog.map((menu) => [menu.id, menu]));
  const visible = cards.filter((card) => byId.has(card.menuId));

  return (
    <div className="minui-root">
      {header}

      <div className="minui-home" data-count={visible.length}>
        {visible.map((card) => {
          const menu = byId.get(card.menuId)!;
          const detail = renderCardDetail?.(card.menuId);
          return (
            <MenuCard
              key={card.menuId}
              menu={menu}
              card={card}
              {...(detail !== undefined && detail !== null ? { detail } : {})}
              onSelect={() => open(card.menuId)}
            />
          );
        })}
      </div>

      <div className="minui-dock">
        {dockExtra}
        <button
          type="button"
          className="minui-dock-button"
          data-variant="quiet"
          onClick={() => setShowAllMenus(true)}
        >
          <span aria-hidden="true">☰</span> 전체 메뉴
        </button>
      </div>

      {showAllMenus && (
        <AllMenuSheet
          catalog={catalog}
          onClose={() => setShowAllMenus(false)}
          onSelect={(menuId) => {
            setShowAllMenus(false);
            open(menuId);
          }}
        />
      )}
    </div>
  );
}
