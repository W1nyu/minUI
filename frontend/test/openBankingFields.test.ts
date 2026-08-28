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
 * <p><b>공식 규격서와 대조했다 (2026-08-28).</b> 오래 비워 뒀던 `official` 칸이 채워졌다 —
 * 출처는 픽스처의 `source`에 있고, 로그인 없이 읽을 수 있는 공개 필드표다. 그전까지
 * 이 칸을 기억으로 채우지 않은 것이 옳았다: `rsp_code`를 4자로 적었다가 걸린 적이 있고,
 * 규격은 <b>AN(5)</b>였다.
 *
 * <p>재는 것 셋.
 * <ul>
 *   <li><b>있는가</b> — 규격이 필수라고 적은 필드를 우리가 실제로 내보내는가
 *   <li><b>맞는가</b> — 그 값이 규격의 타입(길이) 안에 드는가. `AN(5)`면 영숫자 5자 이하
 *   <li><b>없는 것을 아는가</b> — 안 내는 필드는 표에 <b>줄로 남기고</b> 이유를 적는다.
 *       지우면 "29개 중 25개"가 "25개 중 25개"로 보인다
 * </ul>
 *
 * <p>이제 "일부 재현했다"가 <b>세는 말</b>이 된다.
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
  /** null이면 **우리가 안 내는 필드.** 표에서 지우지 않고 줄로 남긴 것이다. */
  ours: Rule | null;
  official: string;
  note?: string;
}

/**
 * 규격 표기가 허용하는 값인가. `AN(5)` → 영숫자 5자 이하.
 *
 * <p>문자 종류와 길이만 본다. 그 이상(조합 규칙·코드 체계)은 필드표에 없어서 잴 수 없고,
 * <b>잴 수 없는 것을 잰 척하지 않는다.</b>
 *
 * <p>길이는 글자 수로 센다. `AH`는 한글이 들어가는 자리라 규격이 바이트를 셀 수도 있는데,
 * 우리 값은 어느 쪽으로 세도 한참 아래라 이 차이가 결과를 바꾸지 않는다.
 */
function fitsOfficial(notation: string, value: unknown): boolean {
  if (notation === "<object>") return Array.isArray(value) || typeof value === "object";
  const parsed = /^([a-zA-Z]+)\*?\((\d+)\)$/.exec(notation);
  if (!parsed) return false;
  const [, kind, max] = parsed;
  if (typeof value !== "string") return false;
  if (value.length > Number(max)) return false;

  switch (kind!.toUpperCase()) {
    // 숫자만.
    case "N":
      return /^[0-9]*$/.test(value);
    // 영문·숫자.
    case "AN":
      return /^[0-9A-Za-z]*$/.test(value);
    // 마스킹된 숫자 — `*`가 섞인다.
    case "NS":
      return /^[0-9*\-]*$/.test(value);
    // 한글이 허용되는 자리, 그리고 특수문자가 섞이는 자리.
    case "AH":
    case "ANS":
      return true;
    default:
      return false;
  }
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

/**
 * 한 묶음을 잰다. **우리 규칙과 규격 표기를 둘 다 통과해야 한다.**
 *
 * <p>`ours`가 null인 줄은 우리가 안 내는 필드다 — 없다고 실패시키지 않는다.
 * 대신 <b>정말로 없는지</b> 확인한다. 안 낸다고 적어 놓고 내보내면 표가 거짓말이 된다.
 */
function check(
  specs: FieldSpec[],
  source: Record<string, unknown>,
  whole: Record<string, unknown>,
): string[] {
  const wrong: string[] = [];
  for (const spec of specs) {
    const value = source[spec.field];

    if (spec.ours === null) {
      if (value !== undefined) {
        wrong.push(`${spec.field}: 안 낸다고 적어 놓고 내보내고 있다`);
      }
      continue;
    }

    if (value === undefined) {
      wrong.push(`${spec.field}: 없음 (규격 ${spec.official})`);
      continue;
    }
    if (!CHECKS[spec.ours](value, whole)) {
      wrong.push(`${spec.field}: ${spec.ours}가 아님 (${JSON.stringify(value).slice(0, 40)})`);
      continue;
    }
    if (!fitsOfficial(spec.official, value)) {
      wrong.push(
        `${spec.field}: 규격 ${spec.official}을 벗어났다 (${JSON.stringify(value).slice(0, 40)})`,
      );
    }
  }
  return wrong;
}

describe("규격과 대조한다", () => {
  it("최상위 필드가 전부 있고 형태가 맞는다", async () => {
    const response = await depositResponse();

    expect(check(SPEC.top as FieldSpec[], response, response)).toEqual([]);
  });

  it("거래 줄(res_list) 필드가 전부 있고 형태가 맞는다", async () => {
    const response = await depositResponse();
    const line = (response["res_list"] as Record<string, unknown>[])[0]!;

    expect(check(SPEC.line as FieldSpec[], line, line)).toEqual([]);
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

  it("대조했다면 출처와 날짜가 남아 있다 ★", () => {
    /*
     * `true`라고 적는 것은 쉽고, 그 순간 이 표는 근거가 아니라 주장이 된다.
     * **어디서 봤는지와 언제 봤는지**가 함께 있어야 다음 사람이 다시 확인할 수 있다.
     */
    expect(SPEC.verifiedAgainstOfficialSpec).toBe(true);
    expect(SPEC.source).toMatch(/^https:\/\//);
    expect(SPEC.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 대조했다면 빈 칸이 없어야 한다. 하나라도 비면 "대조했다"가 참이 아니다.
    const fields = [...SPEC.top, ...SPEC.line] as FieldSpec[];
    expect(fields.filter((spec) => !spec.official)).toEqual([]);
  });

  it("안 내는 필드는 이유가 적혀 있다 ★", () => {
    /*
     * 재현하지 않은 것을 조용히 두면 표가 "우리가 낸 것 목록"이 되고, 그러면
     * 몇 개 중 몇 개인지 셀 수 없다. **줄로 남기되 이유를 적는다.**
     */
    const skipped = ([...SPEC.top, ...SPEC.line] as FieldSpec[]).filter(
      (spec) => spec.ours === null,
    );
    expect(skipped.length).toBeGreaterThan(0);
    for (const spec of skipped) {
      expect(spec.note, `${spec.field}: 왜 안 내는지 적혀 있지 않다`).toMatch(/재현하지 않는다/);
    }
  });
});

describe("몇 개 중 몇 개인가", () => {
  it("셀 수 있는 문장을 낸다", () => {
    const fields = [...SPEC.top, ...SPEC.line] as FieldSpec[];
    const emitted = fields.filter((spec) => spec.ours !== null);

    /*
     * 발표에서 쓸 문장이 여기서 나온다. **"일부 재현했다"는 검증할 수 있는 말이 아니다** —
     * 몇 개인지, 어느 것인지, 왜 안 냈는지가 없으면 아무도 확인할 수 없다.
     */
    console.log(
      `  [KFTC 필드 대조] 규격 ${fields.length}개 중 ${emitted.length}개를 낸다 · ` +
        `안 내는 ${fields.length - emitted.length}개는 이유를 적었다 · ` +
        `재현 안 한 것 ${SPEC.notReproduced.length}가지 (${SPEC.checkedOn} 대조)`,
    );

    // 규격 필드 수가 줄면 누군가 표에서 줄을 지운 것이다. 그러면 비율이 좋아 보인다.
    expect(fields.length).toBe(29);
  });
});
