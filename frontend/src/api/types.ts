/**
 * 데모 은행 앱의 백엔드 계약.
 *
 * M1에서 Spring Boot 구현으로 갈아끼울 지점이 이 인터페이스 하나다.
 * 화면들은 `BankApi`만 알고 있으므로, 교체할 때 UI 코드는 건드리지 않는다.
 */

export interface Account {
  id: string;
  number: string;
  nickname: string;
  /** 원 단위. 실제 계정계에서는 원장 합계로 산출된다 (기획안 §10.1). */
  balance: number;
}

export interface Transaction {
  id: string;
  at: string;
  direction: "in" | "out";
  amount: number;
  counterparty: string;
  balanceAfter: number;
}

export interface AutoTransfer {
  id: string;
  payee: string;
  amount: number;
  /** 매월 며칠 */
  dayOfMonth: number;
  active: boolean;
}

export interface Payee {
  /** 수취인의 계좌 ID. 이체 요청이 그대로 쓴다. */
  id: string;
  name: string;
  number: string;
  lastSentAt: string;
}

export interface TransferRequest {
  fromAccountId: string;
  /** 계좌번호가 아니라 계좌 ID로 지정한다. 번호는 사람이 읽는 표기일 뿐이다. */
  toAccountId: string;
  amount: number;
  memo?: string;
}

export interface TransferResult {
  id: string;
  at: string;
  amount: number;
  payee: string;
  balanceAfter: number;
}

export interface UpcomingDeposit {
  id: string;
  label: string;
  expectedAt: string;
  amount: number;
}

export interface BankApi {
  /** Contest-only virtual Open Banking implementation, never a real bank. */
  readonly demoMode?: "open-banking-mock";
  /**
   * 연습 모드인가 (F14). `demoMode`와 같은 모양의 표시다.
   *
   * <p>화면들이 이 값을 보고 <b>완료 문구만</b> 바꾼다. 무엇을 부를지는 여전히
   * 구현이 정하므로, 이 표시를 지워도 연습이 진짜 이체가 되지는 않는다.
   */
  readonly practice?: boolean;
  listAccounts(): Promise<Account[]>;
  listTransactions(accountId: string): Promise<Transaction[]>;
  listAutoTransfers(): Promise<AutoTransfer[]>;
  setAutoTransferActive(id: string, active: boolean): Promise<void>;
  listRecentPayees(): Promise<Payee[]>;
  listUpcomingDeposits(): Promise<UpcomingDeposit[]>;
  /**
   * 멱등성 키는 M1의 실제 구현에서 중복 이체를 막는 데 쓰인다.
   * 목 구현도 같은 계약을 지켜, 화면 쪽 코드가 나중에 바뀌지 않게 한다.
   */
  transfer(request: TransferRequest, idempotencyKey: string): Promise<TransferResult>;
}
