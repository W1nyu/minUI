import type { MenuId } from "@minui/core";
import { MinUIHome, type SttLike } from "@minui/react";
import { makeStt } from "../stt.js";
import { useMemo } from "react";
import { useBank } from "../BankContext.js";
import { CATALOG } from "../catalog.js";
import { formatWon } from "../screens/ScreenFrame.js";

/**
 * MinUI 모드.
 *
 * 이 파일이 짧은 것이 이식 계약의 증거다. 호스트가 하는 일은 카탈로그를 넘기고,
 * 카드가 들고 있을 답을 채워 주는 것뿐이다. 어떤 카드를 보여줄지는 엔진이 정한다.
 */
export function MinUIShell({ stt }: { stt?: SttLike } = {}) {
  const { accounts, deposits, autoTransfers, transactions } = useBank();

  /**
   * 온디바이스 Whisper를 주로, 브라우저 Web Speech를 예비로 쓴다 (`../stt.ts`).
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

  return (
    <MinUIHome
      catalog={CATALOG}
      renderCardDetail={renderCardDetail}
      stt={provider}
      header={
        <header className="minui-greeting">
          <p className="minui-greeting-text">
            <strong>김순자</strong>님, 안녕하세요
          </p>
        </header>
      }
    />
  );
}
