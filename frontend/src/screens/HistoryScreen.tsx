import { useEffect } from "react";
import { useBank } from "../BankContext.js";
import { ScreenFrame, formatDate, formatWon } from "./ScreenFrame.js";

export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const { transactions, complete } = useBank();

  useEffect(() => {
    if (transactions.length > 0) complete("inquiry.history");
  }, [transactions.length, complete]);

  return (
    <ScreenFrame title="거래 내역" onBack={onBack}>
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
