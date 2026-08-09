import type { MenuCatalog, MenuId } from "@minui/core";
import { useEffect, useMemo, useRef } from "react";
import { TextScaleControl } from "./TextScaleControl.js";
import { useMinUI } from "./useMinUI.js";

export interface AllMenuSheetProps {
  catalog: MenuCatalog;
  onClose: () => void;
  onSelect: (menuId: MenuId) => void;
}

/**
 * 전체 메뉴 (원칙 P2).
 *
 * 카드에서 사라진 기능도 여기서 100% 도달할 수 있다. 이 화면이 없으면 MinUI는
 * "기능을 못 쓰게 만드는 축소"가 되고, 그것은 이 프로젝트의 목적이 아니다.
 *
 * 카드 홈이 아니라 여기에 고정(핀) 버튼을 둔 이유: 핀은 자주 쓰는 기능이 아니라
 * 자동화가 어긋났을 때 쓰는 탈출구다. 홈에 두면 홈이 다시 복잡해진다.
 */
export function AllMenuSheet({ catalog, onClose, onSelect }: AllMenuSheetProps) {
  const { isPinned, togglePin } = useMinUI();
  const closeRef = useRef<HTMLButtonElement>(null);

  const groups = useMemo(() => {
    const byCategory = new Map<string, MenuCatalog[number][]>();
    for (const menu of catalog) {
      const list = byCategory.get(menu.category) ?? [];
      list.push(menu);
      byCategory.set(menu.category, list);
    }
    return [...byCategory.entries()];
  }, [catalog]);

  // 열자마자 닫기 버튼에 초점을 준다. 되돌아가는 길을 먼저 알려주는 편이
  // 목록을 먼저 읽히는 것보다 덜 불안하다.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="minui-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="minui-sheet-title"
    >
      <div className="minui-sheet-header">
        <h2 className="minui-sheet-title" id="minui-sheet-title">
          전체 메뉴
        </h2>
        <button
          type="button"
          className="minui-sheet-close"
          onClick={onClose}
          ref={closeRef}
        >
          <span aria-hidden="true">←</span> 돌아가기
        </button>
      </div>

      <div className="minui-sheet-body">
        {/*
          글씨 크기 조절은 홈이 아니라 여기에 있다. 88dp를 지키면 이 컨트롤은
          카드와 맞먹는 덩치가 되는데, 홈에서 카드와 시선을 다투게 할 물건이 아니다.
          한 번 정하고 거의 건드리지 않는 설정이라 "앱을 손보는 곳"에 모아 둔다.
        */}
        <section className="minui-group">
          <h3 className="minui-group-name">글씨 크기</h3>
          <TextScaleControl />
        </section>

        {groups.map(([category, menus]) => (
          <section className="minui-group" key={category}>
            <h3 className="minui-group-name">{category}</h3>
            <ul className="minui-group-list">
              {menus.map((menu) => {
                const pinned = isPinned(menu.id);
                return (
                  <li key={menu.id}>
                    <div className="minui-menu-row">
                      <button
                        type="button"
                        className="minui-menu-row-open"
                        onClick={() => onSelect(menu.id)}
                        style={OPEN_BUTTON_STYLE}
                      >
                        {menu.label}
                      </button>
                      <button
                        type="button"
                        className="minui-menu-row-pin"
                        aria-pressed={pinned}
                        onClick={() => togglePin(menu.id)}
                      >
                        {pinned ? "고정 해제" : "홈에 고정"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * 행 전체가 열기 버튼이고, 오른쪽 끝에 고정 버튼이 얹힌다.
 * 버튼 안에 버튼을 넣을 수 없으므로 두 형제를 두되 열기 쪽이 남은 폭을 다 먹는다.
 */
const OPEN_BUTTON_STYLE = {
  flex: 1,
  minHeight: "inherit",
  border: "none",
  background: "none",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  padding: 0,
} as const;
