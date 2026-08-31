import { DEFAULT_USER_ID, userById } from "../session/personas.js";
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
 * Spring Boot 데모 서버에 붙는 구현 (M1 + 공모전 Mock).
 *
 * <p>조회는 데모 원장 API를, 최종 확인 뒤 이체는 오픈뱅킹 입금이체 형식의 Mock endpoint를
 * 쓴다. 둘 다 이 저장소 안의 가상 계정계이고 실제 은행·마이데이터 연동은 아니다.
 */
export class HttpBankApi implements BankApi {
  /** The Spring demo server also provides only the virtual Mock contract. */
  readonly demoMode = "open-banking-mock" as const;
  readonly #baseUrl: string;
  /**
   * 지금 보고 있는 사람.
   *
   * <p>전에는 이 자리에 `primaryAccountId = "acc-1"` 상수가 있었고 주석에 "로그인이
   * 없으므로 세션 대신 상수다"라고 적혀 있었다. 로그인이 생겼으므로 상수가 사람이 됐다.
   * 기본값을 남겨 두는 것은 호환이다 — 안 넘기면 지금까지처럼 김순자로 돈다.
   */
  readonly #userId: string;
  /**
   * 시연용 세션 표식. **인증이 아니다** — 서버도 이 값으로 소유권만 가려낼 뿐이고,
   * 없으면 지금까지처럼 아무나 부를 수 있는 상태로 돈다.
   */
  readonly #session: string | undefined;

  constructor(
    baseUrl = "http://localhost:8080",
    options: { userId?: string; session?: string } = {},
  ) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#userId = options.userId ?? DEFAULT_USER_ID;
    this.#session = options.session;
  }

  async listAccounts(): Promise<Account[]> {
    /*
     * 사람으로 물어본다. 전에는 계좌 전부를 받아 와 `acc-1`·`acc-2`만 남겼다 —
     * 계좌가 여섯일 때만 되는 방식이었고, 무엇보다 <b>남의 통장이 브라우저까지
     * 왔다가 화면 앞에서 걸러졌다.</b> 자르는 자리는 서버여야 한다.
     */
    const accounts = await this.#get<RawAccount[]>(
      `/api/users/${encodeURIComponent(this.#userId)}/accounts`,
    );
    // 개시 분개는 회계 장치이지 사용자의 통장이 아니다. 화면에서는 감춘다.
    return accounts
      .filter((account) => account.id !== "acc-opening")
      .map((account) => ({
        id: account.id,
        number: account.number,
        nickname: account.nickname,
        balance: Number(account.balance),
      }));
  }

  async listTransactions(accountId: string): Promise<Transaction[]> {
    const rows = await this.#get<RawTransaction[]>(
      `/api/accounts/${encodeURIComponent(accountId)}/transactions`,
    );
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      direction: row.direction,
      amount: Number(row.amount),
      counterparty: row.counterparty,
      balanceAfter: Number(row.balanceAfter),
    }));
  }

  async listAutoTransfers(): Promise<AutoTransfer[]> {
    const rows = await this.#get<RawAutoTransfer[]>(
      `/api/users/${encodeURIComponent(this.#userId)}/auto-transfers`,
    );
    return rows.map((row) => ({
      id: row.id,
      payee: row.payee,
      amount: Number(row.amount),
      dayOfMonth: row.dayOfMonth,
      active: row.active,
    }));
  }

  async setAutoTransferActive(id: string, active: boolean): Promise<void> {
    await this.#send(`/api/auto-transfers/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
  }

  async listRecentPayees(): Promise<Payee[]> {
    const rows = await this.#get<RawPayee[]>(
      `/api/users/${encodeURIComponent(this.#userId)}/payees`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      number: row.number,
      lastSentAt: row.lastSentAt,
    }));
  }

  async listUpcomingDeposits(): Promise<UpcomingDeposit[]> {
    const rows = await this.#get<RawUpcomingDeposit[]>(
      `/api/users/${encodeURIComponent(this.#userId)}/upcoming-deposits`,
    );
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      expectedAt: row.expectedAt,
      amount: Number(row.amount),
    }));
  }

  async transfer(
    request: TransferRequest,
    idempotencyKey: string,
  ): Promise<TransferResult> {
    const source = (await this.listAccounts()).find((account) => account.id === request.fromAccountId);
    if (!source) throw new Error("보낼 가상 계좌를 찾을 수 없습니다.");

    /*
     * 이체만은 공모전 Mock endpoint로 보낸다. 조회 화면은 기존 계정계의 읽기 API를 쓰되,
     * 최종 확인 뒤의 이체 요청·응답은 금융결제원 Open Banking의 입금이체 JSON 형태를
     * 따른다. `demo-session-token`은 이 서버에서만 통하는 공개 시연 표식이며 실토큰이 아니다.
     */
    const response = await this.#send("/mock/openbanking/v2.0/transfer/deposit/fin_num", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer demo-session-token",
      },
      body: JSON.stringify({
        cntr_account_type: "N",
        cntr_account_num: source.number.replace(/-/g, ""),
        wd_pass_phrase: "DEMO_ONLY",
        wd_print_content: request.memo ?? "minUI 가상이체",
        name_check_option: "on",
        tran_dtime: kftcDateTime(new Date()),
        req_cnt: "1",
        req_list: [
          {
            tran_no: "1",
            /*
             * 명세의 은행거래고유번호가 이 데모의 멱등성 키 역할을 한다.
             *
             * 규격은 `AN(20)` — **영문·숫자만이다.** 앱이 넘기는 것은
             * `crypto.randomUUID()`라 그대로 자르면 하이픈이 남는다.
             * `openBankingMock.ts`가 같은 자리에서 같은 이유로 같은 것을 한다 —
             * 두 원장이 같은 전문을 보내야 대조가 성립한다.
             */
            bank_tran_id: idempotencyKey.replace(/[^0-9A-Za-z]/g, "").slice(0, 20),
            fintech_use_num: fintechUseNumber(request.toAccountId),
            print_content: request.memo ?? "minUI 가상이체",
            tran_amt: String(request.amount),
            req_client_name: this.#holderName(),
            req_client_num: "MINUI-DEMO-USER",
            transfer_purpose: "TR",
          },
        ],
      }),
    });

    const result = (await response.json()) as RawOpenBankingTransferResult;
    const received = result.res_list[0];
    if (!received || result.rsp_code !== "A0000") throw new Error("가상 이체 결과를 확인할 수 없습니다.");
    return {
      id: result.api_tran_id,
      at: new Date().toISOString(),
      amount: Number(received.tran_amt),
      payee: received.account_alias,
      balanceAfter: source.balance - Number(received.tran_amt),
    };
  }

  async #get<T>(path: string): Promise<T> {
    const response = await this.#send(path, { method: "GET" });
    return (await response.json()) as T;
  }

  /** 요청을 보낸 사람의 이름. 전에는 `"김순자"`가 글자 그대로 박혀 있었다. */
  #holderName(): string {
    return userById(this.#userId)?.name ?? "미니은행 이용자";
  }

  async #send(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        ...(this.#session ? { "X-Demo-Session": this.#session } : {}),
      },
    });

    if (!response.ok) {
      // 백엔드가 사용자에게 그대로 보여도 되는 한국어 메시지를 준다.
      // 코드를 다시 번역하는 층을 두지 않는 것이 서로에게 낫다.
      const message = await response
        .json()
        .then((body: { message?: string }) => body.message)
        .catch(() => undefined);
      throw new Error(message ?? `요청에 실패했습니다 (${response.status})`);
    }

    return response;
  }
}

interface RawAccount {
  id: string;
  number: string;
  nickname: string;
  currency: string;
  balance: number | string;
}

interface RawTransaction {
  id: string;
  at: string;
  direction: "in" | "out";
  amount: number | string;
  counterparty: string;
  balanceAfter: number | string;
}

interface RawAutoTransfer {
  id: string;
  payee: string;
  amount: number | string;
  dayOfMonth: number;
  active: boolean;
}

interface RawPayee {
  id: string;
  name: string;
  number: string;
  lastSentAt: string;
}

interface RawUpcomingDeposit {
  id: string;
  label: string;
  expectedAt: string;
  amount: number | string;
}

interface RawOpenBankingTransferResult {
  api_tran_id: string;
  rsp_code: string;
  res_list: Array<{
    account_alias: string;
    tran_amt: string;
  }>;
}

/** `acc-6`처럼 데모에만 있는 ID를 24자리 핀테크이용번호로 바꾼다. */
function fintechUseNumber(accountId: string): string {
  const suffix = Number(accountId.replace(/^acc-/, ""));
  if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error("가상 수취 계좌를 찾을 수 없습니다.");
  return `110000000000000000${String(suffix).padStart(6, "0")}`;
}

function kftcDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
