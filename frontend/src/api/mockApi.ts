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
 * M3용 목 구현. M1에서 Spring Boot 백엔드로 교체된다.
 *
 * 데이터는 페르소나 A(김순자, 73세, 연금 수령자)를 기준으로 짰다 — 관리비 정기 이체,
 * 연금 입금 확인, 소액 잔액. 임의의 숫자를 넣는 것보다 시나리오 S1~S3을 그대로
 * 재현할 수 있는 데이터가 검증에 쓸모 있다.
 */

const ACCOUNTS: Account[] = [
  { id: "acc-1", number: "110-234-567890", nickname: "주거래 통장", balance: 1_243_500 },
  { id: "acc-2", number: "110-987-654321", nickname: "적금 통장", balance: 6_100_000 },
];

const TRANSACTIONS: Transaction[] = [
  {
    id: "tx-1",
    at: "2026-08-05T09:12:00+09:00",
    direction: "in",
    amount: 612_000,
    counterparty: "국민연금공단",
    balanceAfter: 1_243_500,
  },
  {
    id: "tx-2",
    at: "2026-07-25T10:03:00+09:00",
    direction: "out",
    amount: 187_000,
    counterparty: "행복아파트 관리사무소",
    balanceAfter: 631_500,
  },
  {
    id: "tx-3",
    at: "2026-07-18T14:40:00+09:00",
    direction: "out",
    amount: 50_000,
    counterparty: "김미영",
    balanceAfter: 818_500,
  },
  {
    id: "tx-4",
    at: "2026-07-05T09:11:00+09:00",
    direction: "in",
    amount: 612_000,
    counterparty: "국민연금공단",
    balanceAfter: 868_500,
  },
];

const AUTO_TRANSFERS: AutoTransfer[] = [
  { id: "auto-1", payee: "행복아파트 관리사무소", amount: 187_000, dayOfMonth: 25, active: true },
  { id: "auto-2", payee: "한국전력공사", amount: 42_300, dayOfMonth: 18, active: true },
  { id: "auto-3", payee: "실버케어 보험", amount: 68_000, dayOfMonth: 10, active: false },
];

const PAYEES: Payee[] = [
  {
    id: "payee-1",
    name: "행복아파트 관리사무소",
    bank: "우리",
    number: "1002-345-678901",
    lastSentAt: "2026-07-25T10:03:00+09:00",
  },
  {
    id: "payee-2",
    name: "김미영",
    bank: "국민",
    number: "612-21-0987-654",
    lastSentAt: "2026-07-18T14:40:00+09:00",
  },
  {
    id: "payee-3",
    name: "박정호",
    bank: "신한",
    number: "110-456-789012",
    lastSentAt: "2026-06-02T11:20:00+09:00",
  },
];

const DEPOSITS: UpcomingDeposit[] = [
  {
    id: "dep-1",
    label: "국민연금",
    expectedAt: "2026-09-05T09:00:00+09:00",
    amount: 612_000,
  },
];

export class MockBankApi implements BankApi {
  #accounts = ACCOUNTS.map((a) => ({ ...a }));
  #transactions = TRANSACTIONS.map((t) => ({ ...t }));
  #autoTransfers = AUTO_TRANSFERS.map((a) => ({ ...a }));
  /** 같은 키로 두 번 들어온 이체를 한 번으로 만든다 — M1 백엔드와 같은 계약. */
  #idempotency = new Map<string, TransferResult>();

  async listAccounts(): Promise<Account[]> {
    return this.#accounts.map((a) => ({ ...a }));
  }

  async listTransactions(accountId: string): Promise<Transaction[]> {
    // 목 데이터는 주거래 통장 것만 있다. 적금 통장은 빈 목록이 정상 응답이다.
    return accountId === "acc-1" ? this.#transactions.map((t) => ({ ...t })) : [];
  }

  async listAutoTransfers(): Promise<AutoTransfer[]> {
    return this.#autoTransfers.map((a) => ({ ...a }));
  }

  async setAutoTransferActive(id: string, active: boolean): Promise<void> {
    const target = this.#autoTransfers.find((a) => a.id === id);
    if (target) target.active = active;
  }

  async listRecentPayees(): Promise<Payee[]> {
    return PAYEES.map((p) => ({ ...p }));
  }

  async listUpcomingDeposits(): Promise<UpcomingDeposit[]> {
    return DEPOSITS.map((d) => ({ ...d }));
  }

  async transfer(
    request: TransferRequest,
    idempotencyKey: string,
  ): Promise<TransferResult> {
    const existing = this.#idempotency.get(idempotencyKey);
    if (existing) return { ...existing };

    const account = this.#accounts.find((a) => a.id === request.fromAccountId);
    if (!account) throw new Error("계좌를 찾을 수 없습니다.");
    if (request.amount <= 0) throw new Error("보낼 금액을 입력해 주세요.");
    if (account.balance < request.amount) throw new Error("잔액이 부족합니다.");

    account.balance -= request.amount;
    const payee =
      PAYEES.find((p) => p.number === request.toNumber)?.name ?? request.toNumber;

    const result: TransferResult = {
      id: `tx-${this.#transactions.length + 1}`,
      at: new Date().toISOString(),
      amount: request.amount,
      payee,
      balanceAfter: account.balance,
    };

    this.#transactions.unshift({
      id: result.id,
      at: result.at,
      direction: "out",
      amount: request.amount,
      counterparty: payee,
      balanceAfter: account.balance,
    });
    this.#idempotency.set(idempotencyKey, result);

    return { ...result };
  }
}
