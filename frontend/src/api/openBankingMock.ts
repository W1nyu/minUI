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
 * 금융결제원 오픈뱅킹의 `transfer/deposit/fin_num` 흐름을 **시연 전용으로** 재현한다.
 *
 * <p>여기에 실제 은행 주소·인증서·접근 토큰은 없다. 필드 이름과 한 건씩 처리하는 흐름을
 * 맞춰, UI가 나중에 실제 연동 어댑터로 바뀌어도 확인 단계와 요청 경계가 흐트러지지 않게
 * 하는 Mock gateway다. 실거래 API처럼 보이게 만들기 위한 장식이 아니다.
 */

export const DEMO_ACCESS_TOKEN = "demo-session-token";

export interface OpenBankingDepositRequest {
  cntr_account_type: "N";
  cntr_account_num: string;
  wd_pass_phrase: "DEMO_ONLY";
  wd_print_content: string;
  name_check_option: "on";
  tran_dtime: string;
  req_cnt: "1";
  req_list: [
    {
      tran_no: "1";
      bank_tran_id: string;
      fintech_use_num: string;
      print_content: string;
      tran_amt: string;
      req_client_name: string;
      req_client_num: string;
      transfer_purpose: "TR";
    },
  ];
}

export interface OpenBankingDepositResponse {
  api_tran_id: string;
  api_tran_dtm: string;
  rsp_code: "A0000";
  rsp_message: "";
  wd_bank_code_std: string;
  wd_bank_name: string;
  wd_account_num_masked: string;
  wd_print_content: string;
  wd_account_holder_name: string;
  res_cnt: "1";
  res_list: [
    {
      tran_no: "1";
      bank_tran_id: string;
      bank_tran_date: string;
      bank_code_tran: string;
      bank_rsp_code: "000";
      bank_rsp_message: "";
      fintech_use_num: string;
      account_alias: string;
      bank_code_std: string;
      bank_name: string;
      account_num_masked: string;
      print_content: string;
      account_holder_name: string;
      tran_amt: string;
    },
  ];
}

interface DemoAccount extends Account {
  fintechUseNum: string;
  bankCode: string;
  bankName: string;
  holderName: string;
}

interface DemoLedgerEntry {
  id: string;
  accountId: string;
  transferId: string;
  at: string;
  direction: "in" | "out";
  amount: number;
  counterparty: string;
}

interface StoredTransfer {
  response: OpenBankingDepositResponse;
  result: TransferResult;
}

export interface DemoLedgerSnapshot {
  version: 1;
  accounts: DemoAccount[];
  entries: DemoLedgerEntry[];
  autoTransfers: AutoTransfer[];
  transfers: Record<string, StoredTransfer>;
}

export interface DemoLedgerStorage {
  load(): DemoLedgerSnapshot | null;
  save(snapshot: DemoLedgerSnapshot): void;
  clear(): void;
}

/** 브라우저 탭을 닫으면 사라지는 가상 원장 저장소. */
export class SessionLedgerStorage implements DemoLedgerStorage {
  readonly #key: string;

  constructor(key = "minui.open-banking-mock.v1") {
    this.#key = key;
  }

  load(): DemoLedgerSnapshot | null {
    try {
      const raw = sessionStorage.getItem(this.#key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DemoLedgerSnapshot;
      return parsed.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  save(snapshot: DemoLedgerSnapshot): void {
    try {
      sessionStorage.setItem(this.#key, JSON.stringify(snapshot));
    } catch {
      // 저장소를 쓸 수 없어도 이 탭 메모리 안에서는 시연을 계속한다.
    }
  }

  clear(): void {
    try {
      sessionStorage.removeItem(this.#key);
    } catch {
      // 사생활 보호 모드처럼 저장소가 막힌 경우에도 메모리 초기화는 호출자가 한다.
    }
  }
}

const INITIAL_ACCOUNTS: DemoAccount[] = [
  {
    id: "acc-1",
    number: "110-234-567890",
    nickname: "주거래 통장",
    balance: 1_243_500,
    fintechUseNum: "110000000000000000000001",
    bankCode: "088",
    bankName: "미니은행",
    holderName: "김순자",
  },
  {
    id: "acc-2",
    number: "110-987-654321",
    nickname: "적금 통장",
    balance: 6_100_000,
    fintechUseNum: "110000000000000000000002",
    bankCode: "088",
    bankName: "미니은행",
    holderName: "김순자",
  },
  {
    id: "acc-3",
    number: "1002-345-678901",
    nickname: "행복아파트 관리사무소",
    balance: 0,
    fintechUseNum: "110000000000000000000003",
    bankCode: "020",
    bankName: "행복은행",
    holderName: "행복아파트 관리사무소",
  },
  {
    id: "acc-4",
    number: "612-21-0987-654",
    nickname: "김미영",
    balance: 0,
    fintechUseNum: "110000000000000000000004",
    bankCode: "004",
    bankName: "국민은행",
    holderName: "김미영",
  },
  {
    id: "acc-5",
    number: "110-456-789012",
    nickname: "박정호",
    balance: 0,
    fintechUseNum: "110000000000000000000005",
    bankCode: "088",
    bankName: "미니은행",
    holderName: "박정호",
  },
  {
    id: "acc-6",
    number: "356-910-234567",
    nickname: "김영수 삼촌",
    balance: 540_000,
    fintechUseNum: "110000000000000000000006",
    bankCode: "081",
    bankName: "하나은행",
    holderName: "김영수",
  },
];

const INITIAL_ENTRIES: DemoLedgerEntry[] = [
  {
    id: "tx-1",
    accountId: "acc-1",
    at: "2026-08-05T09:12:00+09:00",
    transferId: "seed-1",
    direction: "in",
    amount: 612_000,
    counterparty: "국민연금공단",
  },
  {
    id: "tx-2",
    accountId: "acc-1",
    at: "2026-07-25T10:03:00+09:00",
    transferId: "seed-2",
    direction: "out",
    amount: 187_000,
    counterparty: "행복아파트 관리사무소",
  },
  {
    id: "tx-3",
    accountId: "acc-1",
    at: "2026-07-18T14:40:00+09:00",
    transferId: "seed-3",
    direction: "out",
    amount: 50_000,
    counterparty: "김미영",
  },
  {
    id: "tx-4",
    accountId: "acc-1",
    at: "2026-07-05T09:11:00+09:00",
    transferId: "seed-4",
    direction: "in",
    amount: 612_000,
    counterparty: "국민연금공단",
  },
];

const INITIAL_AUTO_TRANSFERS: AutoTransfer[] = [
  { id: "auto-1", payee: "행복아파트 관리사무소", amount: 187_000, dayOfMonth: 25, active: true },
  { id: "auto-2", payee: "한국전력공사", amount: 42_300, dayOfMonth: 18, active: true },
  { id: "auto-3", payee: "실버케어 보험", amount: 68_000, dayOfMonth: 10, active: false },
];

function freshSnapshot(): DemoLedgerSnapshot {
  return {
    version: 1,
    accounts: INITIAL_ACCOUNTS.map((account) => ({ ...account })),
    entries: INITIAL_ENTRIES.map((entry) => ({ ...entry })),
    autoTransfers: INITIAL_AUTO_TRANSFERS.map((item) => ({ ...item })),
    transfers: {},
  };
}

function formatKftcDate(date: Date, includeMilliseconds = false): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  const base = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
  return includeMilliseconds ? `${base}${pad(date.getMilliseconds(), 3)}` : base;
}

function maskAccountNumber(number: string): string {
  const visible = number.replace(/[^0-9]/g, "");
  return `${visible.slice(0, 3)}-${visible.slice(3, 7)}-****${visible.slice(-2)}`;
}

function makeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? Math.random().toString(36).slice(2);
  return `${prefix}${random}`.slice(0, 40);
}

function readResult(response: OpenBankingDepositResponse, at: string): TransferResult {
  const recipient = response.res_list[0];
  return {
    id: response.api_tran_id,
    at,
    amount: Number(recipient.tran_amt),
    payee: recipient.account_alias,
    // 이 값은 `transfer`가 만든 결과를 저장할 때 송금 계좌 잔액으로 교체한다.
    balanceAfter: 0,
  };
}

/**
 * API 응답과 내부 원장을 함께 만드는 시연용 gateway.
 *
 * <p>음성이나 모델은 이 클래스를 직접 부르지 않는다. 화면에서 수취인·금액을 사람이 확인한
 * 뒤 `BankApi.transfer` 어댑터가 호출한다.
 */
export class OpenBankingMockApi implements BankApi {
  readonly demoMode = "open-banking-mock" as const;
  readonly #storage: DemoLedgerStorage | undefined;
  readonly #now: () => Date;
  #snapshot: DemoLedgerSnapshot;

  constructor(options: { storage?: DemoLedgerStorage; now?: () => Date } = {}) {
    this.#storage = options.storage;
    this.#now = options.now ?? (() => new Date());
    this.#snapshot = options.storage?.load() ?? freshSnapshot();
  }

  async listAccounts(): Promise<Account[]> {
    return this.#snapshot.accounts
      .filter((account) => account.id === "acc-1" || account.id === "acc-2")
      .map(toAccount);
  }

  async listTransactions(accountId: string): Promise<Transaction[]> {
    const account = this.#accountById(accountId);
    if (!account) return [];
    let running = account.balance;
    return this.#snapshot.entries
      .filter((entry) => entry.accountId === accountId)
      .slice()
      .sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id))
      .map((entry) => {
        const current = {
          id: entry.id,
          at: entry.at,
          direction: entry.direction,
          amount: entry.amount,
          counterparty: entry.counterparty,
          balanceAfter: running,
        } satisfies Transaction;
        running += entry.direction === "out" ? entry.amount : -entry.amount;
        return current;
      });
  }

  async listAutoTransfers(): Promise<AutoTransfer[]> {
    return this.#snapshot.autoTransfers.map((item) => ({ ...item }));
  }

  async setAutoTransferActive(id: string, active: boolean): Promise<void> {
    const target = this.#snapshot.autoTransfers.find((item) => item.id === id);
    if (target) {
      target.active = active;
      this.#persist();
    }
  }

  async listRecentPayees(): Promise<Payee[]> {
    return this.#snapshot.accounts
      .filter((account) => account.id !== "acc-1" && account.id !== "acc-2")
      .map((account) => ({
        id: account.id,
        name: account.nickname,
        number: account.number,
        lastSentAt: this.#lastSentAt(account.id),
      }))
      .sort((left, right) => right.lastSentAt.localeCompare(left.lastSentAt));
  }

  async listUpcomingDeposits(): Promise<UpcomingDeposit[]> {
    return [
      {
        id: "dep-1",
        label: "국민연금",
        expectedAt: "2026-09-05T09:00:00+09:00",
        amount: 612_000,
      },
    ];
  }

  async transfer(request: TransferRequest, idempotencyKey: string): Promise<TransferResult> {
    const existing = this.#snapshot.transfers[idempotencyKey];
    if (existing) return { ...existing.result };

    const source = this.#accountById(request.fromAccountId);
    const destination = this.#accountById(request.toAccountId);
    if (!source || !destination) throw new Error("가상 계좌를 찾을 수 없습니다.");
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new Error("보낼 금액을 입력해 주세요.");
    }
    if (source.id === destination.id) throw new Error("같은 계좌로는 보낼 수 없습니다.");

    const body = this.#makeDepositRequest(source, destination, request.amount, request.memo, idempotencyKey);
    const response = this.#depositByFintechNumber(body, `Bearer ${DEMO_ACCESS_TOKEN}`);
    // 오픈뱅킹 응답의 `api_tran_dtm`은 KFTC 숫자 형식이고, 화면 계약은 ISO 시각을 쓴다.
    // API 원본은 `lastResponseFor`에 그대로 남기고, 화면에는 원장에 기록한 ISO 시각을 준다.
    const result = { ...readResult(response, this.#snapshot.entries[0]!.at), balanceAfter: source.balance };
    this.#snapshot.transfers[idempotencyKey] = { response, result };
    this.#persist();
    return { ...result };
  }

  /** 시연의 흐름을 처음 상태로 되돌린다. 이 탭의 가상 값만 지운다. */
  resetDemoLedger(): void {
    this.#snapshot = freshSnapshot();
    this.#storage?.clear();
    this.#persist();
  }

  /** 테스트와 발표 화면이 실제 JSON 경계를 볼 때 쓰는 시연 전용 진단값. */
  lastResponseFor(idempotencyKey: string): OpenBankingDepositResponse | undefined {
    const response = this.#snapshot.transfers[idempotencyKey]?.response;
    return response ? structuredClone(response) : undefined;
  }

  #makeDepositRequest(
    source: DemoAccount,
    destination: DemoAccount,
    amount: number,
    memo: string | undefined,
    idempotencyKey: string,
  ): OpenBankingDepositRequest {
    const now = this.#now();
    return {
      cntr_account_type: "N",
      cntr_account_num: source.number.replace(/-/g, ""),
      wd_pass_phrase: "DEMO_ONLY",
      wd_print_content: memo || "minUI 가상이체",
      name_check_option: "on",
      tran_dtime: formatKftcDate(now),
      req_cnt: "1",
      req_list: [
        {
          tran_no: "1",
          bank_tran_id: idempotencyKey.slice(0, 20),
          fintech_use_num: destination.fintechUseNum,
          print_content: memo || "minUI 가상이체",
          tran_amt: String(amount),
          req_client_name: source.holderName,
          req_client_num: "MINUI-DEMO-USER",
          transfer_purpose: "TR",
        },
      ],
    };
  }

  #depositByFintechNumber(
    request: OpenBankingDepositRequest,
    authorization: string,
  ): OpenBankingDepositResponse {
    if (authorization !== `Bearer ${DEMO_ACCESS_TOKEN}`) {
      throw new Error("가상 OAuth 동의가 만료되었습니다. 데모를 다시 시작해 주세요.");
    }
    if (request.req_cnt !== "1" || request.req_list.length !== 1) {
      throw new Error("가상 오픈뱅킹은 한 번에 한 건만 처리합니다.");
    }

    const line = request.req_list[0];
    const source = this.#snapshot.accounts.find(
      (account) => account.number.replace(/-/g, "") === request.cntr_account_num,
    );
    const destination = this.#snapshot.accounts.find(
      (account) => account.fintechUseNum === line.fintech_use_num,
    );
    const amount = Number(line.tran_amt);

    if (!source || !destination) throw new Error("가상 계좌 정보를 확인해 주세요.");
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("보낼 금액을 입력해 주세요.");
    if (source.balance < amount) throw new Error("잔액이 부족합니다.");

    source.balance -= amount;
    destination.balance += amount;
    const now = this.#now();
    const at = now.toISOString();
    const transferId = makeId("mock-");
    this.#snapshot.entries.unshift(
      {
        id: `${transferId}-out`,
        accountId: source.id,
        transferId,
        at,
        direction: "out",
        amount,
        counterparty: destination.nickname,
      },
      {
        id: `${transferId}-in`,
        accountId: destination.id,
        transferId,
        at,
        direction: "in",
        amount,
        counterparty: source.nickname,
      },
    );

    return {
      api_tran_id: transferId,
      api_tran_dtm: formatKftcDate(now, true),
      rsp_code: "A0000",
      rsp_message: "",
      wd_bank_code_std: source.bankCode,
      wd_bank_name: source.bankName,
      wd_account_num_masked: maskAccountNumber(source.number),
      wd_print_content: request.wd_print_content,
      wd_account_holder_name: source.holderName,
      res_cnt: "1",
      res_list: [
        {
          tran_no: "1",
          bank_tran_id: line.bank_tran_id,
          bank_tran_date: formatKftcDate(now).slice(0, 8),
          bank_code_tran: destination.bankCode,
          bank_rsp_code: "000",
          bank_rsp_message: "",
          fintech_use_num: destination.fintechUseNum,
          account_alias: destination.nickname,
          bank_code_std: destination.bankCode,
          bank_name: destination.bankName,
          account_num_masked: maskAccountNumber(destination.number),
          print_content: line.print_content,
          account_holder_name: destination.holderName,
          tran_amt: String(amount),
        },
      ],
    };
  }

  #accountById(id: string): DemoAccount | undefined {
    return this.#snapshot.accounts.find((account) => account.id === id);
  }

  #lastSentAt(accountId: string): string {
    return (
      this.#snapshot.entries
        .filter((entry) => entry.accountId === "acc-1" && entry.direction === "out")
        .filter((entry) => entry.counterparty === this.#accountById(accountId)?.nickname)
        .sort((left, right) => right.at.localeCompare(left.at))[0]?.at ?? "1970-01-01T00:00:00.000Z"
    );
  }

  #persist(): void {
    this.#storage?.save(this.#snapshot);
  }
}

/** 테스트에는 격리된 메모리 원장을 쓴다. */
export class MockBankApi extends OpenBankingMockApi {}

/** 실제 정적 데모에는 브라우저 탭 안에서만 남는 가상 원장을 쓴다. */
export class SessionOpenBankingMockApi extends OpenBankingMockApi {
  constructor(key?: string) {
    super({ storage: new SessionLedgerStorage(key) });
  }
}

function toAccount(account: DemoAccount): Account {
  return {
    id: account.id,
    number: account.number,
    nickname: account.nickname,
    balance: account.balance,
  };
}
