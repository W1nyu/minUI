import { groupByPath, headingText, type MenuCatalog, type MenuId } from "@minui/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const { isPinned, togglePin, explain } = useMinUI();
  const closeRef = useRef<HTMLButtonElement>(null);
  /**
   * 도우미가 풀어 준 것. 세션 동안만 들고 있는다 — 카탈로그를 고치지 않는다.
   *
   * <p>`null`은 "물어봤는데 모른다더라"이고 빈 값은 "아직 안 물어봤다"다. 둘을 구분해야
   * 모른다고 답한 자리에 버튼을 다시 띄우지 않는다.
   */
  const [asked, setAsked] = useState<Record<MenuId, string | null>>({});
  const [asking, setAsking] = useState<MenuId | null>(null);

  function ask(menuId: MenuId) {
    if (!explain) return;
    setAsking(menuId);
    void explain(menuId)
      .then((hint) => setAsked((previous) => ({ ...previous, [menuId]: hint })))
      // 도우미가 죽어도 화면은 그대로다. 모른다고 말하고 끝낸다.
      .catch(() => setAsked((previous) => ({ ...previous, [menuId]: null })))
      .finally(() => setAsking(null));
  }
  /**
   * 뜻풀이 요소의 id 앞가지.
   *
   * <p>메뉴 id를 그대로 쓰지 않는다 — `aria-describedby`는 <b>공백으로 나뉜 id 목록</b>이라
   * 라벨에서 나온 id에 공백이 하나라도 있으면 조용히 어긋난다. 자리 번호로 만든다.
   */
  const hintIdPrefix = useId();

  /*
   * 카테고리가 아니라 **상위메뉴**로 묶는다.
   *
   * 카테고리는 사이트가 정한 최상위 구분이라 신한은행은 32개, KB증권은 7개다 —
   * 7개짜리에서는 한 묶음이 100줄이 넘어 묶은 뜻이 사라진다. 실제로 사용자가
   * "이건 이것들 중 하나구나"라고 느끼는 단위는 바로 위 상위메뉴다.
   */
  const groups = useMemo(() => groupByPath(catalog), [catalog]);

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

        {groups.map((group, groupIndex) => (
          <section className="minui-group" key={group.heading}>
            <h3 className="minui-group-name">
              {headingText(group.heading) || "전체"}
            </h3>
            <ul className="minui-group-list">
              {group.menus.map((menu, index) => {
                const pinned = isPinned(menu.id);
                // 카탈로그에 있는 것이 먼저다. 도우미는 그것이 없을 때만 온다.
                const hint = menu.hint ?? asked[menu.id] ?? undefined;
                const answered = menu.id in asked;
                const hintId = hint
                  ? `${hintIdPrefix}-${groupIndex}-${index}`
                  : undefined;
                return (
                  <li key={menu.id}>
                    <div className="minui-menu-row">
                      <button
                        type="button"
                        className="minui-menu-row-open"
                        onClick={() => onSelect(menu.id)}
                        style={OPEN_BUTTON_STYLE}
                        {...(hintId ? { "aria-describedby": hintId } : {})}
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
                    {/*
                      뜻풀이는 버튼 <b>밖</b>에 둔다. 안에 넣으면 접근성 이름이
                      "메뉴명 + 한 문장"이 되는데, 수백 줄짜리 목록에서 그러면
                      스크린리더로 훑어 나갈 수가 없다. 이름은 라벨 그대로 두고
                      설명으로만 연결한다.
                    */}
                    {hint && (
                      <p className="minui-menu-row-hint" id={hintId}>
                        {hint}
                      </p>
                    )}

                    {/*
                      뜻풀이가 없는 자리에만 묻는 버튼을 둔다. 행에 세 번째 버튼을
                      끼워 넣지 않고 **뜻풀이가 놓일 자리**를 쓴다 — 행이 붐비면
                      전체 메뉴가 다시 탐색 문제가 된다.
                    */}
                    {!menu.hint && explain && !answered && (
                      <button
                        type="button"
                        className="minui-menu-row-ask"
                        disabled={asking === menu.id}
                        onClick={() => ask(menu.id)}
                      >
                        {asking === menu.id ? "알아보는 중이에요…" : "이게 무슨 뜻이에요?"}
                      </button>
                    )}

                    {/* 모른다고 답한 자리. 버튼을 되돌리지 않는다 — 같은 답이 또 온다. */}
                    {answered && asked[menu.id] === null && (
                      <p className="minui-menu-row-hint" data-empty="true">
                        뜻을 알 수 없었어요
                      </p>
                    )}
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
