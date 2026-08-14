import type { CardReason, MenuCatalog, MenuId } from "@minui/core";
import { useEffect, useRef, useState } from "react";
import { useMinUI } from "./useMinUI.js";

export interface AdaptationSheetProps {
  catalog: MenuCatalog;
  onClose: () => void;
}

/**
 * 왜 이렇게 보이나요 — **적응했다는 것을 사용자가 알 수 있게** (M8).
 *
 * <p>개인화가 조용한 것은 원칙 P3의 목적이다. 그러나 물어봤을 때 답하지 못하면 그것은
 * 조용한 게 아니라 <b>깜깜한 것</b>이다. 고령 사용자에게 "어제 있던 게 오늘 없다"는 불안이고,
 * 불안의 해소는 배지 하나가 아니라 <b>설명과 되돌릴 길</b>이다.
 *
 * <p>이 화면이 답하는 것은 둘이다.
 * <ol>
 *   <li><b>이 카드가 왜 여기 있는가</b> — 고정했거나, 썼거나, 아직 처음 그대로거나
 *   <li><b>무엇을 배웠는가, 그리고 어떻게 잊게 하는가</b> — M7이 저장을 시작해 놓고
 *       지울 길을 주지 않았다. 잘못 배운 말은 그대로 두면 망각 기한까지 남는다
 * </ol>
 *
 * <p>기능으로 가는 길이 아니라 <b>설명</b>이므로, 홈의 나가는 길 두 개("말로 찾기",
 * "전체 메뉴")를 건드리지 않는다 (원칙 P2).
 */
export function AdaptationSheet({ catalog, onClose }: AdaptationSheetProps) {
  const { explainCards, learnedTerms, forgetTerm, forgetAllTerms } = useMinUI();
  const closeRef = useRef<HTMLButtonElement>(null);
  /** 전부 지우기는 되돌릴 수 없으므로 두 단계로 만든다. 하나씩 지우기는 한 단계다. */
  const [confirmingAll, setConfirmingAll] = useState(false);

  const labelOf = (menuId: MenuId) =>
    catalog.find((menu) => menu.id === menuId)?.label ?? menuId;

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
      aria-labelledby="minui-adaptation-title"
    >
      <div className="minui-sheet-header">
        <h2 className="minui-sheet-title" id="minui-adaptation-title">
          왜 이렇게 보이나요
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
        <section className="minui-group" aria-label="지금 홈에 있는 카드">
          <h3 className="minui-group-name">지금 홈에 있는 카드</h3>
          <ul className="minui-reason-list">
            {explainCards().map((entry) => (
              <li className="minui-reason" key={entry.menuId}>
                <span className="minui-reason-label">{labelOf(entry.menuId)}</span>
                <span className="minui-reason-why">{reasonText(entry.reason)}</span>
                {/*
                  "새로 왔다"는 이유와 다른 정보다 (F3의 변경 고지). 카드 위의 배지가
                  3일 뒤 사라져도 이유는 남으므로, 여기서도 따로 적는다.
                */}
                {entry.isNew && (
                  <span className="minui-mark" data-kind="new">
                    최근에 새로 왔어요
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="minui-group" aria-label="제가 배운 말">
          <h3 className="minui-group-name">제가 배운 말</h3>

          {learnedTerms.length === 0 ? (
            <p className="minui-note">
              아직 배운 말이 없어요. 찾기 어려운 메뉴를 말로 찾아서 끝까지 가시면,
              그때 쓰신 말을 이 기기에 기억해 둘게요.
            </p>
          ) : (
            <>
              <p className="minui-note">
                말로 찾다가 못 알아들었던 말이에요. 이 기기에만 있고 밖으로 나가지 않아요.
              </p>
              <ul className="minui-group-list">
                {learnedTerms.map((entry) => (
                  <li className="minui-learned" key={`${entry.term}:${entry.menuId}`}>
                    <span className="minui-learned-term">“{entry.term}”</span>
                    <span className="minui-learned-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="minui-learned-menu">{labelOf(entry.menuId)}</span>
                    <button
                      type="button"
                      className="minui-forget"
                      onClick={() => forgetTerm(entry.term, entry.menuId)}
                      /*
                        접근성 이름에 무엇을 잊는지 넣는다. 목록에 "잊어버리기" 버튼이
                        여러 개면 스크린리더로는 전부 같은 버튼으로 들린다.
                      */
                      aria-label={`“${entry.term}” 잊어버리기`}
                    >
                      잊어버리기
                    </button>
                  </li>
                ))}
              </ul>

              {confirmingAll ? (
                <p className="minui-confirm">
                  <span>배운 말 {learnedTerms.length}개를 모두 지울까요?</span>
                  <button
                    type="button"
                    className="minui-forget"
                    onClick={() => {
                      forgetAllTerms();
                      setConfirmingAll(false);
                    }}
                  >
                    네, 전부 지울게요
                  </button>
                  <button
                    type="button"
                    className="minui-forget"
                    onClick={() => setConfirmingAll(false)}
                  >
                    아니요
                  </button>
                </p>
              ) : (
                /*
                  되돌릴 수 없는 것은 "전부"뿐이라 그것만 두 단계로 둔다.
                  `window.confirm`을 쓰지 않는 이유: 모달 위의 모달은 그 자체가
                  막다른 길이고, 화면 안에서 물으면 취소도 같은 자리에 있다.
                */
                <button
                  type="button"
                  className="minui-forget"
                  onClick={() => setConfirmingAll(true)}
                >
                  전부 잊어버리기
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * 이유 → 문장. **판단은 엔진에 있고 말만 여기서 고른다.**
 *
 * <p>점수를 그대로 보여 주지 않는다. "1.79점이라 여기 있어요"는 설명이 아니다 —
 * 사람이 셀 수 있는 것(횟수)으로 답해야 사용자가 자기 행동과 화면을 이을 수 있다.
 */
function reasonText(reason: CardReason): string {
  switch (reason.kind) {
    case "pinned":
      return "직접 고정하셔서 늘 여기 있어요";
    case "used":
      return `${reason.views}번 여셔서 올라왔어요`;
    case "preset":
      return "아직 기록이 없어 처음 화면 그대로예요";
  }
}
