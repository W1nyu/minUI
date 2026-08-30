import { SpeakButton } from "@minui/react";
import { useEffect, useMemo } from "react";
import { useBank } from "../BankContext.js";
import { summarizeMonth, summaryText } from "../summary.js";
import { ScreenFrame, formatDate, formatWon } from "./ScreenFrame.js";

export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const { transactions, complete } = useBank();

  useEffect(() => {
    if (transactions.length > 0) complete("inquiry.history");
  }, [transactions.length, complete]);

  /*
   * 이번 달 요약 (AI-7). **모델이 없다** — 합계는 원장에서 나오고 문장은 그것으로
   * 조립된다. 결정론이라 같은 달에 늘 같은 문장이 나오고, 돈을 말하는 문장이 열 때마다
   * 달라지지 않는다.
   */
  const lines = useMemo(
    () => summaryText(summarizeMonth(transactions), formatWon),
    [transactions],
  );

  return (
    <ScreenFrame title="거래 내역" onBack={onBack} menuId="inquiry.history">
      {/*
        목록 **위**에 둔다. 스무 줄을 훑어 스스로 더하는 일을 시키지 않는 것이 요점이라,
        아래에 두면 이미 훑은 뒤에 답을 주는 셈이 된다.

        읽어 주기를 붙인다 — 이 두 줄은 이 화면에서 가장 정보 밀도가 높은 자리다.
      */}
      {lines.length > 0 && (
        <section className="month-summary" aria-label="이번 달 요약">
          <div className="month-summary-head">
            <p className="month-summary-title">이번 달</p>
            <SpeakButton text={lines.join(" ")} label="이번 달 요약을 소리로 들려주기" />
          </div>
          {lines.map((line) => (
            <p className="month-summary-line" key={line}>
              {line}
            </p>
          ))}
        </section>
      )}

      <ul className="tx-list">
        {transactions.map((tx) => (
          <li className="tx" key={tx.id} data-direction={tx.direction}>
            <span className="tx-date">{formatDate(tx.at)}</span>
            <span className="tx-party">{tx.counterparty}</span>
            <strong className="tx-amount">
              {tx.direction === "in" ? "+" : "−"}
              {formatWon(tx.amount)}
            </strong>
            <span className="tx-balance">잔액 {formatWon(tx.balanceAfter)}</span>
          </li>
        ))}
      </ul>
    </ScreenFrame>
  );
}
