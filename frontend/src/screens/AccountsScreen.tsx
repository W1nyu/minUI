import { useEffect } from "react";
import { useBank } from "../BankContext.js";
import { useSessionUser } from "../session/SessionContext.js";
import { ScreenFrame, formatDate, formatWon } from "./ScreenFrame.js";

/**
 * 내 통장 목록 — 그리고 그중 하나를 고르는 자리.
 *
 * <p>전에는 이 메뉴가 스텁이었다. 그럴 만했다 — 통장이 둘인 사람 하나뿐이라 "어느
 * 통장"이라는 물음이 없었기 때문이다. 사람마다 통장 수가 달라지면서 이 화면이
 * <b>고르는 자리</b>로 필요해졌다. 여기서 고른 통장이 거래 내역과 이체의 기본 출금
 * 통장이 된다.
 *
 * <p>잔액 보기(`inquiry.balance`)와 나누는 이유: 저쪽은 <b>답을 읽는</b> 화면이고
 * (탭 0회로 끝나야 한다), 이쪽은 <b>고르는</b> 화면이다. 하나로 합치면 잔액만 보려던
 * 사람이 고르는 화면을 지나가야 한다.
 */
export function AccountsScreen({ onBack }: { onBack: () => void }) {
  const { accounts, selectedAccount, selectAccount, transactions, complete } = useBank();
  const user = useSessionUser();

  useEffect(() => {
    if (accounts.length > 0) complete("inquiry.accounts");
  }, [accounts.length, complete]);

  const total = accounts.reduce((sum, account) => sum + account.balance, 0);

  return (
    <ScreenFrame
      title="전체 계좌 조회"
      onBack={onBack}
      menuId="inquiry.accounts"
      guide="통장을 누르면 그 통장의 내역이 아래에 나옵니다."
    >
      <section className="accounts-total" aria-label="모두 합쳐">
        <p className="accounts-total-label">
          {user ? `${user.name}님의 통장 ${accounts.length}개` : `통장 ${accounts.length}개`}
        </p>
        <strong className="accounts-total-amount">{formatWon(total)}</strong>
      </section>

      <ul className="account-list" role="radiogroup" aria-label="통장 고르기">
        {accounts.map((account) => {
          const chosen = account.id === selectedAccount?.id;
          return (
            <li key={account.id}>
              {/*
                라디오처럼 다룬다 — 여러 개 중 하나가 늘 골라져 있는 상태이기 때문이다.
                버튼 목록으로 두면 스크린리더가 "지금 고른 것"을 말해 주지 못한다.
              */}
              <button
                type="button"
                className="account account-pick"
                role="radio"
                aria-checked={chosen}
                onClick={() => selectAccount(account.id)}
              >
                <span className="account-name">{account.nickname}</span>
                <span className="account-number">{account.number}</span>
                <strong className="account-balance">{formatWon(account.balance)}</strong>
              </button>
            </li>
          );
        })}
      </ul>

      <section className="accounts-recent" aria-label="고른 통장의 최근 내역">
        <h3 className="accounts-recent-title">
          {selectedAccount?.nickname ?? "통장"} 최근 내역
        </h3>
        {transactions.length === 0 ? (
          <p className="notice">아직 이 통장에는 거래가 없습니다.</p>
        ) : (
          <ul className="tx-list">
            {transactions.slice(0, 5).map((tx) => (
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
        )}
      </section>
    </ScreenFrame>
  );
}
