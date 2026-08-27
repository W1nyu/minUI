import { describe, expect, it } from "vitest";
import { OpenBankingMockApi } from "../src/api/openBankingMock.js";
import SPEC from "./fixtures/kftc-deposit-fields.json";

/**
 * 우리 Mock이 **선언한 규격을 실제로 내보내는가**, 그리고 **무엇을 재현하지 않았는가**.
 *
 * <p>지금까지 문서는 "금융결제원 API의 URL·JSON 필드 일부를 재현했다"고만 적어 왔다.
 * "일부"는 검증할 수 있는 말이 아니다 — 몇 개인지, 어느 것인지, 형태가 맞는지 아무도 모른다.
 * 여기서 그것을 <b>세는 것</b>으로 바꾼다.
 *
 * <p><b>이 테스트가 지금 하는 일과 못 하는 일을 갈라 둔다.</b>
 * <ul>
 *   <li>하는 일 — 선언한 필드가 <b>런타임 값으로</b> 전부 나오는지, 형태가 규격 모양인지.
 *       인터페이스만 보고 쓴 것이 아니라 실제 응답을 재므로 조용한 표류가 걸린다
 *   <li>못 하는 일 — <b>공식 규격서와의 대조.</b> 테스트베드 계정이 있어야 하고,
 *       기억으로 규격을 적으면 그 순간 이 수치가 지어낸 값이 된다
 * </ul>
 *
 * <p>그래서 필드표를 `fixtures/kftc-deposit-fields.json`으로 빼고 `official` 칸을 비워 뒀다.
 * 규격서나 테스트베드 응답을 얻는 날 그 칸만 채우면, 이 테스트가 차이를 필드 단위로 찍는다.
 * 그때 "일부 재현했다"가 <b>"N개 중 M개 일치, 불일치 K개"</b>가 된다.
 */

type Rule =
  | "nonEmpty"
  | "string"
  | "digits"
  | "digits3"
  | "digits8"
  | "digits17"
  | "rspCode"
  | "masked"
  | "amount"
  | "atMost20"
  | "list"
  | "countMatchesList";

interface FieldSpec {
  field: string;
  ours: Rule;
  official: string | null;
  note?: string;
}

const CHECKS: Record<Rule, (value: unknown, whole: Record<string, unknown>) => boolean> = {
  string: (value) => typeof value === "string",
  nonEmpty: (value) => typeof value === "string" && value.length > 0,
  digits: (value) => typeof value === "string" && /^[0-9]+$/.test(value),
  digits3: (value) => typeof value === "string" && /^[0-9]{3}$/.test(value),
  digits8: (value) => typeof value === "string" && /^[0-9]{8}$/.test(value),
  digits17: (value) => typeof value === "string" && /^[0-9]{17}$/.test(value),
  /*
   * 영문 한 자 + 숫자 넷. 처음에 4자로 적었다가 이 테스트에 걸렸다 —
   * 실제 값은 `A0000`으로 다섯 자다. 규격을 기억으로 적으면 이렇게 틀린다.
   */
  rspCode: (value) => typeof value === "string" && /^[A-Z][0-9]{4}$/.test(value),
  // 마스킹이 실제로 되어 있는가. 계좌번호가 그대로 나가는 것이 가장 나쁘다.
  masked: (value) => typeof value === "string" && value.includes("*"),
  amount: (value) => typeof value === "string" && /^[0-9]+$/.test(value),
  atMost20: (value) => typeof value === "string" && value.length > 0 && value.length <= 20,
  list: (value) => Array.isArray(value) && value.length > 0,
  countMatchesList: (value, whole) =>
    typeof value === "string" &&
    Array.isArray(whole["res_list"]) &&
    value === String((whole["res_list"] as unknown[]).length),
};

/** 한 번 이체해서 실제 응답을 받는다. 이 테스트의 재료는 인터페이스가 아니라 이 값이다. */
async function depositResponse() {
  const api = new OpenBankingMockApi();
  const payees = await api.listRecentPayees();
  const uncle = payees.find((payee) => payee.name.includes("삼촌")) ?? payees[0]!;
  const key = `field-check-${Math.random()}`;

  await api.transfer({ fromAccountId: "acc-1", toAccountId: uncle.id, amount: 30_000 }, key);

  const response = api.lastResponseFor(key);
  expect(response, "이체 뒤에는 KFTC 모양 응답이 남아 있어야 한다").toBeDefined();
  return response as unknown as Record<string, unknown>;
}

describe("선언한 규격을 실제로 내보내는가", () => {
  it("최상위 필드가 전부 있고 형태가 맞는다", async () => {
    const response = await depositResponse();

    const wrong: string[] = [];
    for (const spec of SPEC.top as FieldSpec[]) {
      const value = response[spec.field];
      if (value === undefined) {
        wrong.push(`${spec.field}: 없음`);
        continue;
      }
      if (!CHECKS[spec.ours](value, response)) {
        wrong.push(`${spec.field}: ${spec.ours}가 아님 (${JSON.stringify(value).slice(0, 40)})`);
      }
    }

    expect(wrong, wrong.join(" · ")).toEqual([]);
  });

  it("거래 줄(res_list) 필드가 전부 있고 형태가 맞는다", async () => {
    const response = await depositResponse();
    const line = (response["res_list"] as Record<string, unknown>[])[0]!;

    const wrong: string[] = [];
    for (const spec of SPEC.line as FieldSpec[]) {
      const value = line[spec.field];
      if (value === undefined) {
        wrong.push(`${spec.field}: 없음`);
        continue;
      }
      if (!CHECKS[spec.ours](value, line)) {
        wrong.push(`${spec.field}: ${spec.ours}가 아님 (${JSON.stringify(value).slice(0, 40)})`);
      }
    }

    expect(wrong, wrong.join(" · ")).toEqual([]);
  });

  it("계좌번호는 응답 어디에도 그대로 나오지 않는다 ★", async () => {
    const response = await depositResponse();
    const api = new OpenBankingMockApi();
    const accounts = await api.listAccounts();

    const raw = JSON.stringify(response);
    for (const account of accounts) {
      const digits = account.number.replace(/-/g, "");
      // 마스킹이 규격 흉내가 아니라 실제로 값을 가리는지 본다 (절대 보호선 규칙 4).
      expect(raw, `${account.nickname}의 계좌번호가 응답에 그대로 있다`).not.toContain(digits);
    }
  });
});

describe("무엇을 재현하지 않았는가 — 숨기지 않는다", () => {
  it("빠뜨린 것 목록이 비어 있지 않다", () => {
    /*
     * 이 목록이 비면 "전부 재현했다"는 뜻이 되는데, 그것은 사실이 아니다.
     * 규격 전체를 따라간 것이 아니라는 사실 자체를 테스트로 잠가 둔다 —
     * 이 프로젝트가 미달을 그대로 적어 온 방식이다.
     */
    expect(SPEC.notReproduced.length).toBeGreaterThan(0);
  });

  it("아직 공식 규격서와 대조하지 않았다는 사실이 표시되어 있다 ★", () => {
    /*
     * 대조한 날 이 값을 true로 바꾸고 `official` 칸을 채운다. 그 전까지는
     * 이 Mock이 규격과 얼마나 같은지 **아무도 모른다**는 것이 정확한 상태다.
     */
    expect(SPEC.verifiedAgainstOfficialSpec).toBe(false);
    expect([...SPEC.top, ...SPEC.line].every((spec) => spec.official === null)).toBe(true);
  });
});

describe("대조 준비가 되어 있는가", () => {
  it("official을 채우면 바로 차이를 낼 수 있다", () => {
    const fields = [...SPEC.top, ...SPEC.line] as FieldSpec[];
    const filled = fields.filter((spec) => spec.official !== null);
    const matched = filled.filter((spec) => spec.official === spec.ours);

    /*
     * 지금은 0/0이다. 규격서를 얻는 날 이 줄이 그대로 수치를 낸다 —
     * 발표 자료에 쓸 문장이 여기서 나온다.
     */
    console.log(
      `  [KFTC 필드 대조] 선언 ${fields.length}개 · 대조함 ${filled.length}개 · ` +
        `일치 ${matched.length}개 · 재현 안 한 것 ${SPEC.notReproduced.length}가지`,
    );
    expect(filled.length).toBe(matched.length);
  });
});
