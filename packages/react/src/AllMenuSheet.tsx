import { groupByPath, headingText, type MenuCatalog, type MenuId } from "@minui/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ContrastControl } from "./ContrastControl.js";
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
  const [query, setQuery] = useState("");
  const searchId = useId();
  /*
   * 카테고리가 아니라 **상위메뉴**로 묶는다.
   *
   * 카테고리는 사이트가 정한 최상위 구분이라 신한은행은 32개, KB증권은 7개다 —
   * 7개짜리에서는 한 묶음이 100줄이 넘어 묶은 뜻이 사라진다. 실제로 사용자가
   * "이건 이것들 중 하나구나"라고 느끼는 단위는 바로 위 상위메뉴다.
   */
  const filteredCatalog = useMemo(() => {
    const needle = squash(query);
    if (needle === "") return catalog;

    return catalog.filter((menu) =>
      [menu.label, menu.hint ?? "", ...(menu.synonyms ?? []), ...(menu.path ?? [])].some((value) =>
        squash(value).includes(needle),
      ),
    );
  }, [catalog, query]);

  const groups = useMemo(
    () => groupByPath(filteredCatalog, catalog),
    [catalog, filteredCatalog],
  );

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
        <form className="minui-all-menu-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor={searchId}>메뉴 검색</label>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="메뉴 이름을 입력하세요"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        {/*
          글씨 크기 조절은 홈이 아니라 여기에 있다. 88dp를 지키면 이 컨트롤은
          카드와 맞먹는 덩치가 되는데, 홈에서 카드와 시선을 다투게 할 물건이 아니다.
          한 번 정하고 거의 건드리지 않는 설정이라 "앱을 손보는 곳"에 모아 둔다.
        */}
        <section className="minui-group">
          <h3 className="minui-group-name">글씨 크기</h3>
          <TextScaleControl />
        </section>

        {/*
          대비를 글씨 크기 **바로 아래**에 둔다. 둘 다 "화면이 안 보인다"에 대한 답이라,
          하나를 찾은 사람이 다른 하나를 못 찾으면 절반만 해결하고 나간다.
        */}
        <section className="minui-group">
          <h3 className="minui-group-name">화면 대비</h3>
          <ContrastControl />
        </section>

        {groups.map((group) => (
          <section className="minui-group" key={group.heading}>
            <h3 className="minui-group-name">
              {headingText(group.heading) || "전체"}
            </h3>
            <ul className="minui-group-list">
              {group.menus.map((menu) => {
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
        {query.trim() !== "" && filteredCatalog.length === 0 && (
          <p className="minui-all-menu-empty" role="status">
            찾는 메뉴가 없습니다.
          </p>
        )}
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

/** 띄어쓰기·기호를 무시해 "자동 이체"와 "자동이체"를 같은 말로 찾는다. */
function squash(value: string): string {
  return value.replace(/[\s/·]+/g, "").toLowerCase();
}
