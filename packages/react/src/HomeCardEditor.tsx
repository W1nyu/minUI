import type { MenuCatalog, MenuId } from "@minui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMinUI } from "./useMinUI.js";

export interface HomeCardEditorProps {
  catalog: MenuCatalog;
  onClose: () => void;
}

/**
 * 사용자가 홈 카드를 직접 고르고 순서를 바꾸는 시트.
 *
 * <p>카드 수를 임의로 늘리지 않는다. 홈을 비우거나 목록처럼 길게 만들면, 자주 쓰는
 * 일을 한눈에 찾게 하려던 카드 홈의 역할이 사라진다. 대신 현재 카드 수만큼만 골라
 * 다른 카드를 넣을 수 있고, 언제든 추천 카드로 되돌릴 수 있다.
 */
export function HomeCardEditor({ catalog, onClose }: HomeCardEditorProps) {
  const { cards, pinnedMenuIds, setPinnedMenuIds } = useMinUI();
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = cards.length;
  const cardable = useMemo(() => catalog.filter((menu) => menu.cardable !== false), [catalog]);
  const byId = useMemo(() => new Map(cardable.map((menu) => [menu.id, menu])), [cardable]);
  const [selected, setSelected] = useState<MenuId[]>(() =>
    pinnedMenuIds.length === cards.length ? [...pinnedMenuIds] : cards.map((card) => card.menuId),
  );
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

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

  function toggle(menuId: MenuId) {
    setNotice("");
    setSelected((previous) => {
      if (previous.includes(menuId)) return previous.filter((id) => id !== menuId);
      if (previous.length >= count) {
        setNotice(`홈에는 ${count}개만 고를 수 있어요. 먼저 고른 카드 하나를 빼 주세요.`);
        return previous;
      }
      return [...previous, menuId];
    });
  }

  function move(menuId: MenuId, direction: -1 | 1) {
    setSelected((previous) => {
      const index = previous.indexOf(menuId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[destination]] = [next[destination]!, next[index]!];
      return next;
    });
  }

  async function save() {
    if (selected.length !== count) return;
    setSaving(true);
    await setPinnedMenuIds(selected);
    onClose();
  }

  async function reset() {
    setSaving(true);
    await setPinnedMenuIds([]);
    onClose();
  }

  return (
    <div className="minui-sheet" role="dialog" aria-modal="true" aria-labelledby="minui-card-editor-title">
      <div className="minui-sheet-header">
        <h2 className="minui-sheet-title" id="minui-card-editor-title">홈 카드 고르기</h2>
        <button type="button" className="minui-sheet-close" onClick={onClose} ref={closeRef} disabled={saving}>
          <span aria-hidden="true">←</span> 돌아가기
        </button>
      </div>

      <div className="minui-sheet-body">
        <p className="minui-note">
          자주 쓰는 기능 {count}개를 고르고, 위아래 버튼으로 순서를 정하세요. 이 선택은 이 기기에만
          저장되며 언제든 추천 카드로 되돌릴 수 있어요.
        </p>

        <section className="minui-group" aria-labelledby="minui-card-order-title">
          <h3 className="minui-group-name" id="minui-card-order-title">홈에 보일 순서</h3>
          <ol className="minui-card-order">
            {selected.map((menuId, index) => {
              const menu = byId.get(menuId);
              if (!menu) return null;
              return (
                <li key={menuId}>
                  <span>{index + 1}. {menu.label}</span>
                  <div>
                    <button type="button" onClick={() => move(menuId, -1)} disabled={index === 0 || saving}>
                      위로
                    </button>
                    <button type="button" onClick={() => move(menuId, 1)} disabled={index === selected.length - 1 || saving}>
                      아래로
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {selected.length !== count && (
            <p className="minui-card-editor-state" role="status">
              {count}개 중 {selected.length}개를 골랐어요.
            </p>
          )}
        </section>

        <section className="minui-group" aria-labelledby="minui-card-picker-title">
          <h3 className="minui-group-name" id="minui-card-picker-title">다른 카드 고르기</h3>
          <ul className="minui-group-list">
            {cardable.map((menu) => {
              const isSelected = selected.includes(menu.id);
              return (
                <li key={menu.id}>
                  <button
                    type="button"
                    className="minui-card-picker"
                    aria-pressed={isSelected}
                    onClick={() => toggle(menu.id)}
                    disabled={saving}
                  >
                    <span>{menu.label}</span>
                    <span>{isSelected ? "홈에 보임" : "홈에 넣기"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {notice && <p className="minui-card-editor-state" role="status">{notice}</p>}

        <button type="button" className="minui-card-editor-save" onClick={() => void save()} disabled={selected.length !== count || saving}>
          {saving ? "바꾸는 중" : "이 카드로 홈 바꾸기"}
        </button>
        <button type="button" className="minui-card-editor-reset" onClick={() => void reset()} disabled={saving}>
          추천 카드로 되돌리기
        </button>
      </div>
    </div>
  );
}
