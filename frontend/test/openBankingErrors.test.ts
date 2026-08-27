import { describe, expect, it } from "vitest";
import {
  DEMO_ACCESS_TOKEN,
  OpenBankingMockApi,
  type OpenBankingDepositRequest,
} from "../src/api/openBankingMock.js";
import CONTRACT from "../../shared/contracts/openbanking-cases.json";

/**
 * **오류까지 계약이다.**
 *
 * <p>이 데모에는 가상 원장이 둘이다 — 정적 배포의 `sessionStorage`와 로컬 Spring의
 * PostgreSQL. 성공 경로는 양쪽 다 확인해 왔지만 <b>거절하는 경우는 아무도 대조하지
 * 않았다.</b> 갈라지면 어디서 봤느냐에 따라 다른 결과가 나오고, 시연에서 그것은 최악이다.
 *
 * <p>맞추는 것은 응답 모양이 아니라 <b>결과</b>다. 실패 응답은 KFTC 모양이 아니기
 * 때문이다 — 그렇게 둔 것은 의도이고(`ApiExceptionHandler`: "실제 금융결제원 응답으로
 * 오인하지 않도록"), `shared/contracts/openbanking-cases.json`에 적어 뒀다.
 *
 * <p>같은 표를 Spring 쪽 `OpenBankingMockApiTest`도 읽는다. 한쪽만 고치면 다른 쪽이
 * 걸린다 — 그것이 이 파일이 있는 이유다.
 */

interface ContractCase {
  id: string;
  what: string;
  outcome: "ok" | "refused" | "idempotent";
  rspCode?: string;
  says?: string;
  note?: string;
}

const CASES = CONTRACT.cases as ContractCase[];
const find = (id: string): ContractCase => {
  const found = CASES.find((c) => c.id === id);
  if (!found) throw new Error(`계약 표에 ${id}가 없다`);
  return found;
};

/** 표가 정한 거절 이유를 실제로 말했는가. */
function refusedBecause(error: unknown, contract: ContractCase): void {
  expect(error, `${contract.what}: 거절해야 하는데 통과했다`).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message, `${contract.what}: 이유가 표와 다르다 — "${message}"`).toMatch(
    new RegExp(contract.says!),
  );
}

/**
 * 정상 요청 하나를 **테스트가 직접 만든다.**
 *
 * <p>Mock의 내부 조립기를 빌리지 않는 것이 요점이다. 외부 호출자가 보낼 법한 전문을
 * 그대로 써야, 거절이 실제 입력에서 나는지 확인된다. 값은 시연 데이터가 정한 것들이다 —
 * 주거래 통장 `110-234-567890`, 김영수 삼촌 `…000006`.
 */
function goodRequest(
  amount = 30_000,
  key = `k-${Math.random()}`.slice(0, 20),
): OpenBankingDepositRequest {
  return {
    cntr_account_type: "N",
    cntr_account_num: "110234567890",
    wd_pass_phrase: "DEMO_ONLY",
    wd_print_content: "대조",
    name_check_option: "on",
    tran_dtime: "20260827120000",
    req_cnt: "1",
    req_list: [
      {
        tran_no: "1",
        bank_tran_id: key,
        fintech_use_num: "110000000000000000000006",
        print_content: "대조",
        tran_amt: String(amount),
        req_client_name: "김순자",
        req_client_num: "MINUI-DEMO-USER",
        transfer_purpose: "TR",
      },
    ],
  };
}

describe("두 Mock이 같은 경우에 같은 답을 한다 — 정적 쪽", () => {
  it("표가 여섯 경우를 정한다", () => {
    // 표가 비면 이 파일 전체가 아무것도 안 재게 된다.
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(CONTRACT.notReproduced.length).toBeGreaterThan(0);
  });

  it("정상 이체는 KFTC 모양으로 성공한다", async () => {
    const api = new OpenBankingMockApi();
    const contract = find("success");

    await api.transfer(
      { fromAccountId: "acc-1", toAccountId: "acc-6", amount: 30_000 },
      "contract-ok",
    );
    const response = api.lastResponseFor("contract-ok");
    expect(response?.rsp_code).toBe(contract.rspCode);
  });

  it("잔액보다 크면 거절한다", async () => {
    const api = new OpenBankingMockApi();
    const error = await api
      .transfer({ fromAccountId: "acc-1", toAccountId: "acc-6", amount: 99_999_999 }, "contract-1")
      .then(() => null)
      .catch((cause: unknown) => cause);
    refusedBecause(error, find("insufficient-balance"));
  });

  it("없는 핀테크이용번호는 거절한다", () => {
    const api = new OpenBankingMockApi();
    const request = goodRequest();
    request.req_list[0].fintech_use_num = "110000000000000000999999";

    let caught: unknown;
    try {
      api.deposit(request, `Bearer ${DEMO_ACCESS_TOKEN}`);
    } catch (cause) {
      caught = cause;
    }
    refusedBecause(caught, find("unknown-fintech-number"));
  });

  it("잘못된 토큰은 거절한다 ★", () => {
    const api = new OpenBankingMockApi();
    let caught: unknown;
    try {
      api.deposit(goodRequest(), "Bearer 남의-토큰");
    } catch (cause) {
      caught = cause;
    }
    refusedBecause(caught, find("bad-token"));
  });

  it("0원은 거절한다", () => {
    const api = new OpenBankingMockApi();
    const request = goodRequest(0);
    request.req_list[0].tran_amt = "0";

    let caught: unknown;
    try {
      api.deposit(request, `Bearer ${DEMO_ACCESS_TOKEN}`);
    } catch (cause) {
      caught = cause;
    }
    refusedBecause(caught, find("zero-amount"));
  });

  it("같은 은행거래 키로 다시 보내도 한 번만 빠진다 ★", async () => {
    const api = new OpenBankingMockApi();
    const before = (await api.listAccounts())[0]!.balance;

    const first = await api.transfer(
      { fromAccountId: "acc-1", toAccountId: "acc-6", amount: 50_000 },
      "contract-retry",
    );
    const again = await api.transfer(
      { fromAccountId: "acc-1", toAccountId: "acc-6", amount: 50_000 },
      "contract-retry",
    );

    expect(again).toEqual(first);
    expect((await api.listAccounts())[0]!.balance).toBe(before - 50_000);
    expect(find("retry-same-bank-tran-id").outcome).toBe("idempotent");
  });

  it("거절한 뒤에는 원장이 그대로다 ★", async () => {
    const api = new OpenBankingMockApi();
    const before = (await api.listAccounts())[0]!.balance;

    await api
      .transfer({ fromAccountId: "acc-1", toAccountId: "acc-6", amount: 99_999_999 }, "contract-2")
      .catch(() => null);

    // 거절했는데 일부라도 빠져 있으면, 그것이 이 Mock이 할 수 있는 가장 나쁜 실수다.
    expect((await api.listAccounts())[0]!.balance).toBe(before);
  });
});
