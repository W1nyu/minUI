import { describe, expect, it } from "vitest";
import {
  DEMO_ACCOUNTS,
  DEMO_GROUPS,
  DEMO_USERS,
  accountsOf,
  userById,
} from "../src/session/personas.js";

/**
 * 시연용 사람과 계좌 표(`shared/contracts/demo-users.json`)가 스스로 모순되지 않는가.
 *
 * <p>이 표는 브라우저 원장과 Spring 원장이 **함께** 읽는다. 한쪽만 보고 고치면 다른 쪽이
 * 조용히 어긋나므로, 표 자체의 무결성은 여기서 한 번에 잰다. `openbanking-cases.json`을
 * 두 Mock이 함께 읽는 것과 같은 자리다.
 */
describe("시연용 사람 표", () => {
  it("사람군 넷이 모두 있고 사용자가 열 명을 넘는다", () => {
    expect(DEMO_USERS.length).toBeGreaterThanOrEqual(10);
    for (const group of ["고령", "중년", "청년", "상점"]) {
      expect(DEMO_GROUPS).toContain(group);
      expect(DEMO_USERS.some((user) => user.group === group)).toBe(true);
    }
  });

  it("사용자 id와 계좌 id·계좌번호가 서로 겹치지 않는다", () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(DEMO_USERS.map((user) => user.id))).toBe(true);
    expect(unique(DEMO_ACCOUNTS.map((account) => account.id))).toBe(true);
    expect(unique(DEMO_ACCOUNTS.map((account) => account.number))).toBe(true);
  });

  it("주인이 있는 계좌는 실재하는 사람을 가리킨다", () => {
    for (const account of DEMO_ACCOUNTS) {
      if (account.ownerId === null) continue;
      expect(userById(account.ownerId), `${account.id}의 주인`).toBeDefined();
    }
  });

  it("로그인할 수 있는 사람은 모두 계좌를 하나 이상 가진다", () => {
    for (const user of DEMO_USERS) {
      expect(accountsOf(user.id).length, `${user.name}의 계좌`).toBeGreaterThan(0);
    }
  });

  /*
   * Mock의 마스킹이 `substring(0, 7)`을 한다 (OpenBankingMockController.mask).
   * 숫자가 일곱 자리에 못 미치는 계좌번호를 표에 적으면 그 자리에서 예외가 난다 —
   * 화면이 아니라 표를 고쳐야 하는 문제라 여기서 잡는다.
   */
  it("계좌번호는 숫자 일곱 자리 이상이다", () => {
    for (const account of DEMO_ACCOUNTS) {
      const digits = account.number.replace(/[^0-9]/g, "");
      expect(digits.length, `${account.id} (${account.number})`).toBeGreaterThanOrEqual(7);
    }
  });

  /*
   * 핀테크이용번호는 `acc-N`의 N을 여섯 자리로 채워 만든다 (httpApi.ts·Mock 양쪽).
   * 표에 `acc-` 형식이 아닌 id가 들어오면 이체가 그 계좌로 못 간다.
   */
  it("계좌 id는 핀테크이용번호로 바꿀 수 있는 모양이다", () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.id, "계좌 id 형식").toMatch(/^acc-[1-9][0-9]*$/);
    }
  });

  it("사람에게 붙은 계좌는 보낼 수 있을 만큼의 잔액을 가진다", () => {
    for (const user of DEMO_USERS) {
      const total = accountsOf(user.id).reduce((sum, account) => sum + account.balance, 0);
      expect(total, `${user.name}의 잔액 합계`).toBeGreaterThan(0);
    }
  });

  /*
   * `acc-1`~`acc-6`은 기존 테스트와 `openbanking-cases.json` 대조가 걸려 있는 값이다.
   * 사람을 늘리다가 이 여섯을 건드리면 그쪽이 조용히 깨지므로 여기에 못을 박아 둔다.
   *
   * <p>acc-3·acc-4의 잔액만 0에서 올라갔다. 시드 거래내역을 **양쪽에** 기록하게 되면서
   * 받은 쪽에도 돈이 남기 때문이다 — 전에는 받는 화면이 없어 0이어도 티가 안 났다.
   */
  it("기존 여섯 계좌의 번호와 잔액이 그대로다", () => {
    const expected = [
      { id: "acc-1", number: "110-234-567890", ownerLabel: "주거래 통장", balance: 1_243_500 },
      { id: "acc-2", number: "110-987-654321", ownerLabel: "적금 통장", balance: 6_100_000 },
      { id: "acc-3", number: "1002-345-678901", nickname: "행복아파트 관리사무소", balance: 187_000 },
      { id: "acc-4", number: "612-21-0987-654", nickname: "김미영", balance: 50_000 },
      { id: "acc-5", number: "110-456-789012", nickname: "박정호", balance: 0 },
      { id: "acc-6", number: "356-910-234567", nickname: "김영수 삼촌", balance: 540_000 },
    ];

    for (const row of expected) {
      const account = DEMO_ACCOUNTS.find((candidate) => candidate.id === row.id);
      expect(account, row.id).toBeDefined();
      expect(account).toMatchObject(row);
    }
  });

  /*
   * **표에 비밀번호가 없다.**
   *
   * <p>사람마다 다른 번호였다가, 전부 `000000`이었다가, 결국 없앴다. 키패드는 은행 앱의
   * 모양을 보여 주는 시늉이고 무엇을 눌러도 들어가므로 비교할 값이 필요 없다.
   *
   * <p>이걸 재는 이유: 누군가 편의로 번호를 다시 적어 넣으면, 그 순간부터 화면이
   * <b>지키는 것이 있는 척</b>하게 된다. 없는 보장을 주장하지 않는 것이 이 저장소가
   * 가상 원장 고지와 연습 모드 배지에서 지켜 온 선이다.
   */
  it("사람 표에 비밀번호를 담지 않는다", () => {
    for (const user of DEMO_USERS) {
      expect(Object.keys(user), `${user.name}`).not.toContain("pin");
      expect(Object.keys(user), `${user.name}`).not.toContain("password");
    }
  });

  it("기관 계좌는 주인이 없어 로그인 대상이 아니다", () => {
    const institutions = DEMO_ACCOUNTS.filter((account) => account.ownerId === null);
    expect(institutions.length).toBeGreaterThan(0);
    for (const account of institutions) {
      // 남이 부르는 이름과 주인이 부르는 이름이 같다 — 부를 주인이 따로 없기 때문이다.
      expect(account.nickname).toBe(account.ownerLabel);
    }
  });
});
