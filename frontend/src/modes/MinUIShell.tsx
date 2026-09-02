import type { MenuId } from "@minui/core";
import { MinUIHome, OnboardingSheet, type SttLike } from "@minui/react";
import { makeStt } from "../stt.js";
import { useMemo, useState } from "react";
import { useBank } from "../BankContext.js";
import { CATALOG } from "../catalog.js";
import { formatWon } from "../screens/ScreenFrame.js";
import { useSessionUser } from "../session/SessionContext.js";
import { summarizeMonth } from "../summary.js";

/**
 * MinUI 모드.
 *
 * 이 파일이 짧은 것이 이식 계약의 증거다. 호스트가 하는 일은 카탈로그를 넘기고,
 * 카드가 들고 있을 답을 채워 주는 것뿐이다. 어떤 카드를 보여줄지는 엔진이 정한다.
 */
const ONBOARDED_KEY = "minui.demo.onboarded";
const FIXED_SUPPORT_LEVEL = "standard";

export function MinUIShell({ stt }: { stt?: SttLike } = {}) {
  const { accounts, deposits, autoTransfers, transactions } = useBank();
  const user = useSessionUser();

  /**
   * 브라우저 Web Speech 하나를 쓴다 (`../stt.ts`).
   * 상용 전환 시 이 한 줄만 다른 구현체로 바꾸면 된다 — 그것이 Provider를 둔 이유다.
   */
  const provider = useMemo<SttLike>(() => stt ?? makeStt(), [stt]);

  /**
   * 카드가 들고 있는 답 (기획안 S2: 잔액 확인은 탭 0회).
   *
   * 카드를 메뉴 이름표로 두면 사용자는 여전히 한 번 더 눌러야 답을 본다.
   * 답을 미리 얹으면 자주 하는 확인은 탭 없이 끝난다.
   */
  function renderCardDetail(menuId: MenuId) {
    switch (menuId) {
      case "inquiry.balance": {
        const primary = accounts[0];
        return primary ? <strong>{formatWon(primary.balance)}</strong> : null;
      }
      case "inquiry.deposit": {
        const next = deposits[0];
        return next ? <>{next.label} {formatWon(next.amount)}</> : null;
      }
      case "inquiry.history": {
        /*
         * 최근 한 건이 아니라 **이번 달 합계**를 얹는다 (AI-7).
         *
         * 전에는 맨 위 거래를 보여 줬는데, 그것은 목록의 첫 줄을 미리 보여 준 것일 뿐
         * 사용자가 알고 싶은 것("이번 달 얼마나 나갔지")에 답하지 않았다. 카드에
         * 답을 얹는다는 S2의 규칙은 <b>목록의 일부</b>가 아니라 <b>물음의 답</b>을
         * 얹으라는 뜻이다.
         */
        const summary = summarizeMonth(transactions);
        if (summary.count === 0) return null;
        return <>이번 달 {formatWon(summary.spent)} 나감</>;
      }
      case "transfer.auto": {
        const active = autoTransfers.filter((item) => item.active).length;
        return <>매달 {active}건 나감</>;
      }
      case "transfer.account":
      case "transfer.recent":
        return <>최근: 행복아파트 관리사무소</>;
      default:
        return null;
    }
  }

  /*
   * 온보딩 2문항 (F5). **언제 띄울지는 호스트가 정한다.**
   *
   * "봤다"를 엔진 상태가 아니라 localStorage에 두는 이유: 엔진 상태에 넣으면
   * `STATE_VERSION`을 올려야 하고, 그러면 이미 쓰던 사람의 카드 배치와 배운 말이
   * 마이그레이션 대상이 된다. 온보딩을 봤는지는 **화면 쪽 사실**이지 엔진이 알아야 할
   * 것이 아니다.
   *
   * 저장소를 못 읽는 환경(사생활 보호 창 등)에서는 매번 뜬다. 건너뛰기가 한 번의
   * 탭이라 그 편이 아예 안 뜨는 것보다 낫다 — 첫 화면이 이미 내 것이어야 한다는 것이
   * F5의 요점이다.
   */
  const [onboarded, setOnboarded] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const finishOnboarding = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      // 못 써도 이번 세션은 넘어간다.
    }
    setOnboarded(true);
  };

  if (!onboarded) return <OnboardingSheet onDone={finishOnboarding} />;

  return (
    <MinUIHome
      catalog={CATALOG}
      renderCardDetail={renderCardDetail}
      stt={provider}
      supportLevel={FIXED_SUPPORT_LEVEL}
      showWhy={false}
      header={
        <header className="minui-greeting">
          {/*
            이름은 로그인한 사람에게서 온다. 전에는 여기에 '김순자'가 글자 그대로
            박혀 있었다 — 사용자가 한 사람이던 때의 흔적이고, 사람을 늘리면 남의
            화면에 남의 이름이 뜨는 자리가 된다.
          */}
          <p className="minui-greeting-text">
            <strong>{user?.name ?? "고객"}</strong>님, 안녕하세요
          </p>
        </header>
      }
    />
  );
}
