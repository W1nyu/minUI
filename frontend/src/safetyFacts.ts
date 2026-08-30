import type { PastTransfer, TransferFacts } from "@minui/core";
import type { Payee, Transaction } from "./api/types.js";

/**
 * 화면 안의 값으로 안심 점검의 재료를 만든다 (F13).
 *
 * <p>이 파일이 `packages/core` 밖에 있는 이유가 요점이다. 코어는 원장도 계좌도 모르고
 * 알 필요도 없다 — 판단 규칙만 갖고 있고, <b>사실은 호스트가 채운다.</b> 그래서 다른
 * 금융 앱은 자기 원장 모양대로 이 함수만 다시 쓰면 된다.
 *
 * <p>여기서 만든 값은 `checkTransfer`가 끝나면 사라진다. 어디에도 저장하지 않고
 * 기기를 떠나지도 않는다 (기획안 §11.1).
 */

/**
 * 거래 내역에서 **보낸 것만** 골라 지난 이체로 바꾼다.
 *
 * <p>내역에는 상대의 이름만 있고 계좌 ID가 없다. 그래서 이름으로 받는 분과 맞춘다 —
 * 같은 이름이 둘이면 구별되지 않지만, <b>그 경우는 `same-name-payee`가 따로 잡는다.</b>
 * 여기서 완벽하게 가르려고 애쓰는 것보다 그쪽에서 사람에게 물어보는 편이 낫다.
 */
export function toPastTransfers(
  transactions: readonly Transaction[],
  payees: readonly Payee[],
): PastTransfer[] {
  const idByName = new Map(payees.map((payee) => [payee.name.trim(), payee.id]));

  return transactions
    .filter((entry) => entry.direction === "out")
    .flatMap((entry) => {
      const payeeId = idByName.get(entry.counterparty.trim());
      if (!payeeId) return [];
      const at = Date.parse(entry.at);
      if (Number.isNaN(at)) return [];
      return [{ payeeId, amount: entry.amount, at }];
    });
}

export interface FactsInput {
  payee: Payee;
  amount: number;
  balance: number;
  transactions: readonly Transaction[];
  payees: readonly Payee[];
  /** 주입 가능하게 둔다. 화면은 호스트라 `Date.now()`를 써도 되지만, 테스트는 아니다. */
  now?: number;
}

export function buildTransferFacts(input: FactsInput): TransferFacts {
  return {
    payeeId: input.payee.id,
    payeeName: input.payee.name,
    amount: input.amount,
    balance: input.balance,
    now: input.now ?? Date.now(),
    history: toPastTransfers(input.transactions, input.payees),
    payeeNames: input.payees.map((payee) => payee.name),
  };
}
