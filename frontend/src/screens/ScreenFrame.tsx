import type { ReactNode } from "react";

export interface ScreenFrameProps {
  title: string;
  onBack: () => void;
  children: ReactNode;
}

/**
 * 모든 기능 화면의 공통 껍데기.
 *
 * 두 UI 모드가 **같은 화면 컴포넌트**를 연다. 기획안 §12.2가 비교 측정에서
 * "UI 외의 변수를 통제한다"고 한 것의 실제 구현이다 — 화면이 갈라지는 순간
 * 두 모드의 완료 시간 차이가 무엇 때문인지 말할 수 없게 된다.
 */
export function ScreenFrame({ title, onBack, children }: ScreenFrameProps) {
  return (
    <div className="screen" role="dialog" aria-modal="true" aria-label={title}>
      {/*
        여기는 의도적으로 <header>가 아니다. <header>는 section/article/main/nav 안에
        있을 때만 배너 역할에서 빠지는데, 이 요소의 부모는 dialog다. <header>를 쓰면
        앱 상단 바와 함께 문서에 배너 랜드마크가 둘 생긴다.
      */}
      <div className="screen-header">
        <button type="button" className="screen-back" onClick={onBack}>
          <span aria-hidden="true">←</span> 뒤로
        </button>
        <h2 className="screen-title">{title}</h2>
      </div>
      <div className="screen-body">{children}</div>
    </div>
  );
}


export const won = new Intl.NumberFormat("ko-KR");

export function formatWon(amount: number): string {
  return `${won.format(amount)}원`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}
