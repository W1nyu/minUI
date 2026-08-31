import {
  DEFAULT_USER_ID,
  DEMO_ACCOUNTS,
  DEMO_AUTO_TRANSFERS,
  DEMO_HISTORY,
  DEMO_UPCOMING_DEPOSITS,
  userById,
} from "../session/personas.js";
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
  /** 기관 계좌는 주인이 없다 — 받기만 하고 로그인 대상이 아니다. */
  ownerId: string | null;
  /**
   * 남이 부르는 이름.
   *
   * <p>`Account.nickname`은 <b>주인이 부르는 이름</b>('주거래 통장')을 담고, 이쪽은
   * 받는 분 목록과 거래내역에 뜨는 이름('김순자')을 담는다. 한 칸으로 합치면 둘 중
   * 하나가 반드시 틀린다 — 남의 이체 목록에 '주거래 통장'이 뜨거나, 내 계좌 목록에
   * 내 이름이 뜬다.
   */
  peerName: string;
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

/**
 * 자동이체는 **어느 계좌에서 나가는지**를 함께 들고 있어야 한다.
 *
 * <p>화면 계약(`AutoTransfer`)에는 그 칸이 없다 — 사용자가 한 사람이던 때는 물어볼
 * 필요가 없었기 때문이다. 이제는 남의 자동이체가 내 화면에 뜨면 안 되므로 원장 쪽에만
 * 한 칸 더 둔다. 화면으로 나갈 때 이 칸은 떨어진다.
 */
interface StoredAutoTransfer extends AutoTransfer {
  fromAccountId: string;
}

interface StoredTransfer {
  response: OpenBankingDepositResponse;
  result: TransferResult;
}

export interface DemoLedgerSnapshot {
  version: 1;
  accounts: DemoAccount[];
  entries: DemoLedgerEntry[];
  autoTransfers: StoredAutoTransfer[];
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

const OPENING_ACCOUNT = "acc-opening";

/** `acc-6`처럼 데모에만 있는 ID를 24자리 핀테크이용번호로 바꾼다. Spring 쪽과 같은 식이다. */
function fintechUseNumber(accountId: string): string {
  const suffix = Number(accountId.replace(/^acc-/, ""));
  return `110000000000000000${String(suffix).padStart(6, "0")}`;
}

/**
 * 사람과 계좌는 `shared/contracts/demo-users.json`에서 온다.
 *
 * <p>전에는 이 파일 안에 여섯 계좌가 박혀 있었다. Spring 시드에도 같은 여섯이 따로
 * 박혀 있었고, 그래서 한쪽만 고치면 조용히 갈라졌다. 표를 하나로 옮긴 뒤로 이 함수가
 * 하는 일은 그 표를 원장이 쓰는 모양으로 바꾸는 것뿐이다.
 */
function seedAccounts(): DemoAccount[] {
  return DEMO_ACCOUNTS.map((account) => ({
    id: account.id,
    number: account.number,
    nickname: account.ownerLabel,
    balance: account.balance,
    ownerId: account.ownerId,
    peerName: account.nickname,
    fintechUseNum: fintechUseNumber(account.id),
    bankCode: account.bankCode,
    bankName: account.bankName,
    holderName:
      (account.ownerId === null ? undefined : userById(account.ownerId)?.name) ?? account.nickname,
  }));
}

/**
 * 시드 거래내역을 **양쪽에** 기록한다.
 *
 * <p>전에는 김순자의 계좌에만 넣었다. 받는 쪽을 볼 화면이 없었으니 티가 안 났을 뿐,
 * 원장으로 보면 한쪽만 움직인 거래였다. 이제 받는 사람으로 로그인할 수 있으므로
 * 딸이 받은 5만원이 딸의 화면에도 있어야 한다.
 *
 * <p>개시 분개(`acc-opening`)에서 온 것은 받는 쪽만 남긴다 — 연금 입금에 '보낸 계좌'를
 * 만들어 주면 화면에 없는 계좌가 거래내역에 나타난다.
 */
function seedEntries(accounts: readonly DemoAccount[]): DemoLedgerEntry[] {
  const peerNameOf = (accountId: string) =>
    accounts.find((account) => account.id === accountId)?.peerName ?? accountId;

  return DEMO_HISTORY.flatMap((row, index) => {
    const transferId = `seed-${index + 1}`;
    const incoming: DemoLedgerEntry = {
      id: `tx-${index + 1}-in`,
      accountId: row.to,
      transferId,
      at: row.at,
      direction: "in",
      amount: row.amount,
      counterparty: row.from === OPENING_ACCOUNT ? row.label : peerNameOf(row.from),
    };

    if (row.from === OPENING_ACCOUNT) return [incoming];

    return [
      {
        id: `tx-${index + 1}-out`,
        accountId: row.from,
        transferId,
        at: row.at,
        direction: "out",
        amount: row.amount,
        counterparty: peerNameOf(row.to),
      } satisfies DemoLedgerEntry,
      incoming,
    ];
  });
}

function seedAutoTransfers(): StoredAutoTransfer[] {
  return DEMO_AUTO_TRANSFERS.map((row) => ({
    id: row.id,
    fromAccountId: row.fromAccountId,
    payee: row.payee,
    amount: row.amount,
    dayOfMonth: row.dayOfMonth,
    active: row.active,
  }));
}

function freshSnapshot(): DemoLedgerSnapshot {
  return {
    version: 1,
    accounts: seedAccounts(),
    entries: seedEntries(seedAccounts()),
    autoTransfers: seedAutoTransfers(),
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
  /**
   * 지금 보고 있는 사람.
   *
   * <p><b>원장은 하나이고 보는 자리만 사람마다 다르다.</b> 그래야 김순자가 보낸 돈이
   * 박정호로 로그인했을 때 실제로 도착해 있다 — 사람마다 원장을 따로 두면 이체가
   * 허공으로 나가고, 그것은 이 데모가 보여 주려는 것과 정반대다.
   *
   * <p>기본값이 있는 것은 편의가 아니라 호환이다. 안 넘기면 지금까지처럼 김순자로 돈다.
   */
  #userId: string;
  #snapshot: DemoLedgerSnapshot;

  constructor(
    options: { storage?: DemoLedgerStorage; now?: () => Date; userId?: string } = {},
  ) {
    this.#storage = options.storage;
    this.#now = options.now ?? (() => new Date());
    this.#userId = options.userId ?? DEFAULT_USER_ID;
    this.#snapshot = options.storage?.load() ?? freshSnapshot();
  }

  /** 지금 보고 있는 사람의 id. 화면이 인사말과 저장소 키에 쓴다. */
  get userId(): string {
    return this.#userId;
  }

  /**
   * 보는 자리를 옮긴다. 원장은 그대로 두고 **필터만** 바꾼다 —
   * 진행자용 빠른 전환이 이 문 하나를 지난다.
   */
  viewAs(userId: string): void {
    this.#userId = userId;
  }

  async listAccounts(): Promise<Account[]> {
    return this.#myAccounts().map(toAccount);
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
    const mine = new Set(this.#myAccounts().map((account) => account.id));
    return this.#snapshot.autoTransfers
      .filter((item) => mine.has(item.fromAccountId))
      .map(({ fromAccountId: _fromAccountId, ...item }) => ({ ...item }));
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
      .filter((account) => account.ownerId !== this.#userId)
      .map((account) => ({
        id: account.id,
        // 받는 분 자리에서는 **남이 부르는 이름**이다. 주인이 뭐라 부르든 상관없다.
        name: account.peerName,
        number: account.number,
        lastSentAt: this.#lastSentAt(account.id),
      }))
      .sort((left, right) => right.lastSentAt.localeCompare(left.lastSentAt));
  }

  async listUpcomingDeposits(): Promise<UpcomingDeposit[]> {
    const mine = new Set(this.#myAccounts().map((account) => account.id));
    return DEMO_UPCOMING_DEPOSITS.filter((row) => mine.has(row.accountId)).map((row) => ({
      id: row.id,
      label: row.label,
      expectedAt: row.expectedAt,
      amount: row.amount,
    }));
  }

  async transfer(request: TransferRequest, idempotencyKey: string): Promise<TransferResult> {
    const existing = this.#snapshot.transfers[idempotencyKey];
    if (existing) return { ...existing.result };

    const source = this.#accountById(request.fromAccountId);
    const destination = this.#accountById(request.toAccountId);
    if (!source || !destination) throw new Error("가상 계좌를 찾을 수 없습니다.");
    /*
     * 로그인한 사람의 계좌에서만 나간다.
     *
     * <p>화면이 내 계좌만 보여 주므로 여기까지 올 일이 없어 보이지만, 막는 자리는
     * 화면이 아니라 원장이어야 한다 — 화면 하나가 실수로 남의 계좌 id를 넘겨도
     * 돈이 움직이면 안 된다.
     */
    if (source.ownerId !== this.#userId) throw new Error("내 계좌가 아닙니다.");
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new Error("보낼 금액을 입력해 주세요.");
    }
    if (source.id === destination.id) throw new Error("같은 계좌로는 보낼 수 없습니다.");

    const body = this.#makeDepositRequest(source, destination, request.amount, request.memo, idempotencyKey);
    const response = this.deposit(body, `Bearer ${DEMO_ACCESS_TOKEN}`);
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
          /*
           * 규격이 `AN(20)` — **영문·숫자만이다.** 전에는 멱등성 키를 그대로 잘라 넣었는데,
           * 앱이 넘기는 것은 `crypto.randomUUID()`라 하이픈이 그대로 남았다. 공식 필드표와
           * 대조하면서 걸린 것이고, 그전까지는 우리 규칙(`atMost20`)만 봐서 통과했다.
           *
           * 멱등 판정은 원본 키로 하므로(`#snapshot.transfers`) 여기서 다듬어도
           * 같은 요청을 두 번 보냈을 때의 동작은 바뀌지 않는다.
           */
          bank_tran_id: idempotencyKey.replace(/[^0-9A-Za-z]/g, "").slice(0, 20),
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

  /**
   * 흉내 내는 그 엔드포인트 — `transfer/deposit/fin_num`.
   *
   * <p><b>공개해 둔다.</b> `transfer()`만 열어 두면 잘못된 토큰과 없는 핀테크이용번호
   * 경로에 닿을 방법이 없어, 거절이 실제로 도는지 확인할 수 없다. 이 Mock이 흉내 내는
   * 대상이 바로 이 엔드포인트이므로 표면으로 두는 것이 맞다
   * (`shared/contracts/openbanking-cases.json`이 두 Mock의 결과를 대조한다).
   */
  deposit(
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
        counterparty: destination.peerName,
      },
      {
        id: `${transferId}-in`,
        accountId: destination.id,
        transferId,
        at,
        direction: "in",
        amount,
        counterparty: source.peerName,
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
          account_alias: destination.peerName,
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

  /** 표에 적힌 순서를 지킨다 — 첫 계좌가 주거래다. */
  #myAccounts(): DemoAccount[] {
    return this.#snapshot.accounts.filter((account) => account.ownerId === this.#userId);
  }

  /**
   * 내가 저 사람에게 마지막으로 보낸 때. 받는 분 목록의 순서를 정한다.
   *
   * <p>전에는 `acc-1`만 봤다. 계좌가 여럿인 사람은 어느 통장에서 보냈든 같은 사람이므로
   * **내 계좌 전부**를 본다.
   */
  #lastSentAt(accountId: string): string {
    const mine = new Set(this.#myAccounts().map((account) => account.id));
    const peerName = this.#accountById(accountId)?.peerName;
    return (
      this.#snapshot.entries
        .filter((entry) => mine.has(entry.accountId) && entry.direction === "out")
        .filter((entry) => entry.counterparty === peerName)
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
  constructor(options: { userId?: string; key?: string } = {}) {
    super({
      storage: new SessionLedgerStorage(options.key),
      ...(options.userId ? { userId: options.userId } : {}),
    });
  }
}

function toAccount(account: DemoAccount): Account {
  return {
    id: account.id,
    number: account.number,
    // 내 계좌 목록이므로 **주인이 부르는 이름**이다.
    nickname: account.nickname,
    balance: account.balance,
  };
}
