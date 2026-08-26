import { useEffect } from "react";
import { useBank } from "../BankContext.js";
import { ScreenFrame, formatWon } from "./ScreenFrame.js";

export function BalanceScreen({ onBack }: { onBack: () => void }) {
  const { accounts, complete } = useBank();

  // 잔액 화면은 "본 것"이 곧 "끝낸 것"이다. 계좌가 그려지는 순간 작업 완료로 기록한다.
  useEffect(() => {
    if (accounts.length > 0) complete("inquiry.balance");
  }, [accounts.length, complete]);

  return (
    <ScreenFrame title="잔액 보기" onBack={onBack} menuId="inquiry.balance">
      <ul className="account-list">
        {accounts.map((account) => (
          <li className="account" key={account.id}>
            <span className="account-name">{account.nickname}</span>
            <span className="account-number">{account.number}</span>
            <strong className="account-balance">{formatWon(account.balance)}</strong>
          </li>
        ))}
      </ul>
    </ScreenFrame>
  );
}
