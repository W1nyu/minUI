import type {
  Account,
  AutoTransfer,
  BankApi,
  Payee,
  Transaction,
  TransferRequest,
  TransferResult,
  UpcomingDeposit,
} from "./types.js";

/**
 * 연습 모드 (F14) — **끝까지 해 보되 아무것도 움직이지 않는다.**
 *
 * <p>고령 사용자가 이체 화면에서 멈추는 이유는 어디를 누를지 몰라서만이 아니다.
 * 알겠는데도 <b>"눌렀다가 잘못되면 어쩌나"</b>에서 손이 멈춘다. 그 사람에게 필요한 것은
 * 설명이 아니라 <b>되돌릴 수 있는 한 번</b>이다.
 *
 * <p>구현이 데코레이터인 것이 요점이다. 조회는 원래 것을 그대로 통과시키고 `transfer`
 * 하나만 가로챈다. 그래서 <b>화면 코드가 한 줄도 바뀌지 않는다</b> — 연습이라는 사실을
 * 화면들이 알 필요가 없고, 실수로 어느 화면이 연습을 잊고 진짜 API를 부르는 경로도
 * 생기지 않는다. `BankApi` 계약 하나만 지키면 되는 것이 M1에서 인터페이스를 뽑아 둔
 * 이유이기도 하다.
 *
 * <p>가상 원장조차 건드리지 않는다. 데모의 Mock도 결국 잔액을 바꾸고, 그러면 연습을
 * 두 번 한 사람의 잔액이 줄어 있다. 연습은 <b>흔적이 남지 않아야</b> 연습이다.
 */
export class PracticeBankApi implements BankApi {
  readonly practice = true;

  /**
   * 감싼 것의 시연 표기를 그대로 물려받는다. 가상 오픈뱅킹 고지가 사라지면 안 된다.
   *
   * <p>getter가 아니라 생성자에서 <b>있을 때만</b> 대입한다. `exactOptionalPropertyTypes`
   * 아래에서 선택 속성은 "없거나 그 값"이지 "undefined일 수 있음"이 아니다 — getter로
   * 두면 `undefined`를 돌려줄 수 있어 계약이 넓어진다.
   */
  readonly demoMode?: "open-banking-mock";

  readonly #inner: BankApi;

  constructor(inner: BankApi) {
    this.#inner = inner;
    if (inner.demoMode !== undefined) this.demoMode = inner.demoMode;
  }

  listAccounts(): Promise<Account[]> {
    return this.#inner.listAccounts();
  }

  listTransactions(accountId: string): Promise<Transaction[]> {
    return this.#inner.listTransactions(accountId);
  }

  listAutoTransfers(): Promise<AutoTransfer[]> {
    return this.#inner.listAutoTransfers();
  }

  listRecentPayees(): Promise<Payee[]> {
    return this.#inner.listRecentPayees();
  }

  listUpcomingDeposits(): Promise<UpcomingDeposit[]> {
    return this.#inner.listUpcomingDeposits();
  }

  /**
   * **자동이체를 멈추는 것도 연습에서는 일어나지 않는다.**
   *
   * <p>이체만 막고 이것을 통과시키면, 연습으로 "그만 내기"를 눌러 본 사람의 자동이체가
   * 정말로 꺼진다. 원장을 안 건드린다는 약속은 돈이 나가는 것에만 걸린 약속이 아니다.
   */
  async setAutoTransferActive(): Promise<void> {
    return;
  }

  /**
   * 보내는 시늉만 한다. **가상 원장도 부르지 않는다.**
   *
   * <p>거절해야 할 것은 그대로 거절한다 — 금액이 없거나 계좌를 못 찾으면 연습에서도
   * 같은 이유로 막힌다. 연습에서만 되는 일이 있으면 그것은 연습이 아니라 다른 화면이다.
   */
  async transfer(request: TransferRequest, idempotencyKey: string): Promise<TransferResult> {
    const accounts = await this.#inner.listAccounts();
    const source = accounts.find((account) => account.id === request.fromAccountId);
    const payees = await this.#inner.listRecentPayees();
    const destination = payees.find((payee) => payee.id === request.toAccountId);

    if (!source || !destination) throw new Error("가상 계좌를 찾을 수 없습니다.");
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new Error("보낼 금액을 입력해 주세요.");
    }
    if (source.balance < request.amount) throw new Error("잔액이 부족합니다.");

    return {
      id: `practice-${idempotencyKey}`,
      at: new Date().toISOString(),
      amount: request.amount,
      payee: destination.name,
      // 잔액은 **그대로**다. 연습이 끝난 뒤 홈으로 돌아갔을 때 숫자가 달라져 있으면
      // "실제로는 나가지 않았다"는 말과 화면이 어긋난다.
      balanceAfter: source.balance,
    };
  }
}
