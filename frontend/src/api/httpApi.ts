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
 * 실제 Spring Boot 백엔드에 붙는 구현 (M1).
 *
 * <p>`MockBankApi`와 같은 `BankApi`를 구현하므로 화면 코드는 하나도 바뀌지 않는다.
 * 목을 남겨 두는 이유는 UI 테스트를 빠르고 밀폐되게 유지하기 위해서다 — 카드 배치나
 * 접근성을 검증하는 데 DB가 필요하지는 않다.
 */
export class HttpBankApi implements BankApi {
  readonly #baseUrl: string;
  /** 데모는 계좌 하나를 주거래로 고정한다. 로그인이 없으므로 세션 대신 상수다. */
  readonly #primaryAccountId: string;

  constructor(baseUrl = "http://localhost:8080", primaryAccountId = "acc-1") {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#primaryAccountId = primaryAccountId;
  }

  async listAccounts(): Promise<Account[]> {
    const accounts = await this.#get<RawAccount[]>("/api/accounts");
    // 개시 분개는 회계 장치이지 사용자의 통장이 아니다. 화면에서는 감춘다.
    return accounts
      .filter((account) => account.id !== "acc-opening")
      .filter((account) => account.id === "acc-1" || account.id === "acc-2")
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
      `/api/accounts/${this.#primaryAccountId}/auto-transfers`,
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
      `/api/accounts/${this.#primaryAccountId}/payees`,
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
      `/api/accounts/${this.#primaryAccountId}/upcoming-deposits`,
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
    const response = await this.#send("/api/transfers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 네트워크가 끊겨 응답을 못 받은 클라이언트가 다시 보내도 이체는 한 번이다.
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        fromAccountId: request.fromAccountId,
        toAccountId: request.toAccountId,
        amount: request.amount,
        memo: request.memo ?? null,
      }),
    });

    const result = (await response.json()) as RawTransferResult;
    return {
      id: result.id,
      at: result.at,
      amount: Number(result.amount),
      payee: result.counterparty,
      balanceAfter: Number(result.balanceAfter),
    };
  }

  async #get<T>(path: string): Promise<T> {
    const response = await this.#send(path, { method: "GET" });
    return (await response.json()) as T;
  }

  async #send(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.#baseUrl}${path}`, init);

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

interface RawTransferResult {
  id: string;
  at: string;
  amount: number | string;
  counterparty: string;
  balanceAfter: number | string;
  replayed: boolean;
}
