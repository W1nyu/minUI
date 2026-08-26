import type { MenuId } from "@minui/core";
import { MinUIHome, OnboardingSheet, type SttLike } from "@minui/react";
import { makeStt } from "../stt.js";
import { useMemo, useState } from "react";
import { useBank } from "../BankContext.js";
import {
  supportLevelText,
  useAdaptiveSupport,
  type SupportLevel,
} from "../adaptation/AdaptiveSupport.js";
import { CATALOG } from "../catalog.js";
import { formatWon } from "../screens/ScreenFrame.js";

/**
 * MinUI 모드.
 *
 * 이 파일이 짧은 것이 이식 계약의 증거다. 호스트가 하는 일은 카탈로그를 넘기고,
 * 카드가 들고 있을 답을 채워 주는 것뿐이다. 어떤 카드를 보여줄지는 엔진이 정한다.
 */
const ONBOARDED_KEY = "minui.demo.onboarded";

export function MinUIShell({ stt }: { stt?: SttLike } = {}) {
  const { accounts, deposits, autoTransfers, transactions } = useBank();
  const adaptive = useAdaptiveSupport();

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
        const latest = transactions[0];
        return latest ? (
          <>
            {latest.counterparty} {latest.direction === "in" ? "+" : "−"}
            {formatWon(latest.amount)}
          </>
        ) : null;
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

  const level: SupportLevel = adaptive.consented ? adaptive.level : "guided";

  return (
    <MinUIHome
      catalog={CATALOG}
      renderCardDetail={renderCardDetail}
      stt={provider}
      supportLevel={level}
      onInteraction={(interaction) => {
        if (interaction.kind === "press") adaptive.recordPress(interaction.durationMs);
        else adaptive.recordVoice(interaction.durationMs);
      }}
      header={
        <header className="minui-greeting">
          <p className="minui-greeting-text">
            <strong>김순자</strong>님, 안녕하세요
          </p>
          <AdaptiveSupportControl />
        </header>
      }
    />
  );
}

/**
 * "불안도"라는 낙인 대신 사용자가 보는 것은 화면의 도움 정도뿐이다.
 *
 * <p>동의 전에는 어떤 원문·메뉴 ID·음성도 저장하지 않는다. 동의 뒤에도 남는 것은 합계 네
 * 개뿐이고 탭을 닫거나 이 버튼으로 지우면 사라진다.
 */
function AdaptiveSupportControl() {
  const adaptive = useAdaptiveSupport();

  if (!adaptive.asked) {
    return (
      <section className="adaptive-support" aria-label="화면 도움 설정">
        <p>
          누름 시간·되돌아감·말하기 대기 시간을 <strong>이 탭 안에서 합계만</strong> 보고,
          화면을 더 단순하게 맞출까요?
        </p>
        <div>
          <button type="button" onClick={adaptive.grantConsent}>
            네, 맞춰 주세요
          </button>
          <button type="button" onClick={adaptive.declineConsent}>
            아니요, 지금 화면 유지
          </button>
        </div>
      </section>
    );
  }

  if (!adaptive.consented) {
    return (
      <button type="button" className="adaptive-support-link" onClick={adaptive.grantConsent}>
        화면 도움 맞추기
      </button>
    );
  }

  return (
    <section className="adaptive-support" aria-label="현재 화면 도움 정도">
      <p>
        화면 도움: <strong>{supportLevelText(adaptive.level)}</strong>
      </p>
      <button type="button" onClick={adaptive.forget}>
        도움 기록 지우기
      </button>
    </section>
  );
}
