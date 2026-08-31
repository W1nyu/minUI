import { describe, expect, it } from "vitest";
import { OpenBankingMockApi, type DemoLedgerSnapshot, type DemoLedgerStorage } from "../src/api/openBankingMock.js";

/**
 * 여러 사람이 **같은 원장**을 서로 다른 자리에서 본다.
 *
 * <p>이 데모가 지금까지 못 보여 준 것이 하나 있다 — 이체는 원장 양쪽을 정확히 움직이는데
 * 받는 쪽을 볼 화면이 없었다. 보낸 것을 받는 사람으로 로그인해 확인하는 것이 여기서
 * 재려는 전부다. 그래서 <b>원장은 하나로 두고 보는 자리만 사람마다 다르게</b> 만든다.
 */

class SharedLedgerStorage implements DemoLedgerStorage {
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

/** 같은 원장을 보는 두 사람. 시연에서 로그아웃 후 다시 로그인하는 것과 같은 모양이다. */
function sharedLedger() {
  const storage = new SharedLedgerStorage();
  return {
    as: (userId: string) => new OpenBankingMockApi({ storage, userId }),
  };
}

describe("사람마다 다른 자리에서 보는 하나의 원장", () => {
  it("내 계좌 목록에는 내 것만 있다", async () => {
    const ledger = sharedLedger();

    const sunja = await ledger.as("u-1").listAccounts();
    const jungho = await ledger.as("u-8").listAccounts();

    // 표에 적힌 순서가 곧 통장 순서다 — 각 사람의 첫 줄이 주거래 통장이다.
    expect(sunja.map((account) => account.id)).toEqual(["acc-1", "acc-2"]);
    expect(jungho.map((account) => account.id)).toEqual(["acc-12", "acc-5"]);
    expect(sunja.some((account) => account.id === "acc-12")).toBe(false);
  });

  it("내 계좌는 내가 부르는 이름으로, 남의 계좌는 남이 부르는 이름으로 보인다", async () => {
    const ledger = sharedLedger();

    const [primary] = await ledger.as("u-1").listAccounts();
    expect(primary?.nickname).toBe("주거래 통장");

    const payees = await ledger.as("u-8").listRecentPayees();
    expect(payees.map((payee) => payee.name)).toContain("김순자");
  });

  it("받는 분 목록에 내 계좌는 안 뜬다", async () => {
    const ledger = sharedLedger();

    const payees = await ledger.as("u-1").listRecentPayees();
    const ids = payees.map((payee) => payee.id);

    expect(ids).not.toContain("acc-1");
    expect(ids).not.toContain("acc-2");
    expect(ids).toContain("acc-6");
  });

  /** 이 저장소가 여태 못 보여 준 것. 보낸 돈이 받는 사람 화면에 실제로 도착한다. */
  it("보낸 돈이 받는 사람으로 로그인했을 때 도착해 있다", async () => {
    const ledger = sharedLedger();

    const beforeJungho = (await ledger.as("u-8").listAccounts()).find(
      (account) => account.id === "acc-12",
    );
    await ledger
      .as("u-1")
      .transfer({ fromAccountId: "acc-1", toAccountId: "acc-12", amount: 30_000 }, "cross-user-1");

    const sunjaAfter = (await ledger.as("u-1").listAccounts()).find(
      (account) => account.id === "acc-1",
    );
    const junghoAfter = (await ledger.as("u-8").listAccounts()).find(
      (account) => account.id === "acc-12",
    );

    expect(sunjaAfter?.balance).toBe(1_243_500 - 30_000);
    expect(junghoAfter?.balance).toBe((beforeJungho?.balance ?? 0) + 30_000);

    const incoming = await ledger.as("u-8").listTransactions("acc-12");
    expect(incoming[0]).toMatchObject({
      direction: "in",
      amount: 30_000,
      counterparty: "김순자",
    });
  });

  it("보낸 사람의 거래내역에는 받는 사람 이름이 남는다", async () => {
    const ledger = sharedLedger();
    await ledger
      .as("u-1")
      .transfer({ fromAccountId: "acc-1", toAccountId: "acc-12", amount: 12_000 }, "cross-user-2");

    const outgoing = await ledger.as("u-1").listTransactions("acc-1");
    expect(outgoing[0]).toMatchObject({
      direction: "out",
      amount: 12_000,
      counterparty: "박정호 월급",
    });
  });

  it("남의 자동이체와 입금 예정은 내 화면에 안 뜬다", async () => {
    const ledger = sharedLedger();

    const sunjaAuto = await ledger.as("u-1").listAutoTransfers();
    const junghoAuto = await ledger.as("u-8").listAutoTransfers();

    expect(sunjaAuto.map((row) => row.payee)).toContain("행복아파트 관리사무소");
    expect(junghoAuto.map((row) => row.payee)).not.toContain("행복아파트 관리사무소");
    expect(junghoAuto.map((row) => row.payee)).toContain("행복마트");

    const junghoDeposits = await ledger.as("u-8").listUpcomingDeposits();
    expect(junghoDeposits.map((row) => row.label)).not.toContain("국민연금");
  });

  it("남의 계좌에서는 보낼 수 없다", async () => {
    const ledger = sharedLedger();

    await expect(
      ledger
        .as("u-8")
        .transfer({ fromAccountId: "acc-1", toAccountId: "acc-12", amount: 1_000 }, "not-mine-1"),
    ).rejects.toThrow(/내 계좌가 아닙니다|보낼 가상 계좌/);
  });

  /*
   * 사용자를 안 넘기면 지금까지와 똑같이 김순자로 돈다. 기존 테스트와 계측 대본이
   * 그 전제 위에 있어서, 기본값을 바꾸면 이 작업과 상관없는 것들이 조용히 깨진다.
   */
  it("사용자를 안 넘기면 지금까지처럼 김순자로 본다", async () => {
    const accounts = await new OpenBankingMockApi().listAccounts();
    expect(accounts.map((account) => account.id)).toEqual(["acc-1", "acc-2"]);
  });
});
