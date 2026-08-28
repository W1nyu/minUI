import { describe, expect, it } from "vitest";
import { OpenBankingMockApi, type DemoLedgerSnapshot, type DemoLedgerStorage } from "../src/api/openBankingMock.js";

class MemoryLedgerStorage implements DemoLedgerStorage {
  value: DemoLedgerSnapshot | null = null;

  load(): DemoLedgerSnapshot | null {
    return this.value;
  }

  save(snapshot: DemoLedgerSnapshot): void {
    this.value = structuredClone(snapshot);
  }

  clear(): void {
    this.value = null;
  }
}

describe("시연용 오픈뱅킹 Mock", () => {
  it("한 건의 이체가 KFTC 형식 응답과 양쪽 원장 변화를 함께 만든다", async () => {
    const api = new OpenBankingMockApi({ now: () => new Date("2026-08-26T01:02:03.456Z") });
    const before = await api.listAccounts();
    const result = await api.transfer(
      { fromAccountId: "acc-1", toAccountId: "acc-6", amount: 30_000 },
      "demo-bank-transaction-0001",
    );
    const after = await api.listAccounts();
    const response = api.lastResponseFor("demo-bank-transaction-0001");

    expect(result.payee).toBe("김영수 삼촌");
    expect(result.balanceAfter).toBe(before[0]!.balance - 30_000);
    expect(after[0]!.balance).toBe(before[0]!.balance - 30_000);
    expect(response).toMatchObject({
      rsp_code: "A0000",
      res_cnt: "1",
      wd_bank_code_std: "088",
      res_list: [
        {
          /*
           * 하이픈이 빠진다. 규격이 `AN(20)` — 영문·숫자만이라, 멱등성 키에서
           * 영숫자만 남겨 자른다 (`openBankingFields.test.ts`의 대조에서 걸린 자리).
           * 멱등 판정은 원본 키로 하므로 재시도 동작은 그대로다.
           */
          bank_tran_id: "demobanktransaction0",
          fintech_use_num: "110000000000000000000006",
          account_alias: "김영수 삼촌",
          tran_amt: "30000",
        },
      ],
    });

    const history = await api.listTransactions("acc-1");
    expect(history[0]).toMatchObject({
      direction: "out",
      amount: 30_000,
      counterparty: "김영수 삼촌",
      balanceAfter: before[0]!.balance - 30_000,
    });
  });

  it("같은 은행거래 키는 재시도여도 한 번만 차감한다", async () => {
    const api = new OpenBankingMockApi();
    const before = (await api.listAccounts())[0]!.balance;
    const request = { fromAccountId: "acc-1", toAccountId: "acc-4", amount: 50_000 };

    const first = await api.transfer(request, "same-bank-tran-id");
    const retry = await api.transfer(request, "same-bank-tran-id");

    expect(retry).toEqual(first);
    expect((await api.listAccounts())[0]!.balance).toBe(before - 50_000);
    expect((await api.listTransactions("acc-1")).filter((row) => row.at === first.at)).toHaveLength(1);
  });

  it("탭 저장소에 남겼다가 새 API 인스턴스가 같은 가상 원장을 읽는다", async () => {
    const storage = new MemoryLedgerStorage();
    const first = new OpenBankingMockApi({ storage });
    await first.transfer(
      { fromAccountId: "acc-1", toAccountId: "acc-4", amount: 10_000 },
      "persisted-key",
    );

    const restored = new OpenBankingMockApi({ storage });
    expect((await restored.listAccounts())[0]!.balance).toBe(1_233_500);
    expect((await restored.listRecentPayees())[0]!.name).toBe("김미영");

    restored.resetDemoLedger();
    expect((await restored.listAccounts())[0]!.balance).toBe(1_243_500);
  });
});
