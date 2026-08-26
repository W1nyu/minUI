import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpBankApi } from "../src/api/httpApi.js";

afterEach(() => vi.unstubAllGlobals());

describe("Spring Boot 가상 오픈뱅킹 어댑터", () => {
  it("최종 확인 뒤에만 핀테크이용번호 기반 입금이체 JSON을 만든다", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: "acc-1", number: "110-234-567890", nickname: "주거래 통장", currency: "KRW", balance: "1243500" },
            { id: "acc-2", number: "110-987-654321", nickname: "적금 통장", currency: "KRW", balance: "6100000" },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            api_tran_id: "mock-1",
            rsp_code: "A0000",
            res_list: [{ account_alias: "김영수 삼촌", tran_amt: "30000" }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    const api = new HttpBankApi("http://mock.local");
    const result = await api.transfer(
      { fromAccountId: "acc-1", toAccountId: "acc-6", amount: 30_000 },
      "uuid-idempotency-key-for-demo",
    );

    expect(result).toMatchObject({ payee: "김영수 삼촌", amount: 30_000, balanceAfter: 1_213_500 });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://mock.local/mock/openbanking/v2.0/transfer/deposit/fin_num",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer demo-session-token" }),
      }),
    );
    const request = JSON.parse((fetch.mock.calls[1]![1] as RequestInit).body as string);
    expect(request).toMatchObject({
      cntr_account_num: "110234567890",
      req_cnt: "1",
      req_list: [
        {
          bank_tran_id: "uuid-idempotency-key".slice(0, 20),
          fintech_use_num: "110000000000000000000006",
          tran_amt: "30000",
          transfer_purpose: "TR",
        },
      ],
    });
  });
});
