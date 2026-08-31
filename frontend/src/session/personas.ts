import CONTRACT from "../../../shared/contracts/demo-users.json";

/**
 * 시연용 사람과 계좌를 읽어 오는 자리.
 *
 * <p>표 자체는 `shared/contracts/demo-users.json`에 있고 Spring 원장도 **같은 파일**을
 * 읽는다. 여기서 하는 일은 그 표에 타입을 붙이고 몇 가지 조회를 얹는 것뿐이다 —
 * 사람을 이 파일에 적기 시작하면 두 원장이 갈라진다.
 *
 * <p><b>비밀번호가 없다.</b> 로그인 화면의 키패드는 은행 앱의 모양을 보여 주려고 둔
 * 시늉이고 무엇을 눌러도 들어간다. 그래서 이 표에도 번호가 없다 — 값을 적어 두면
 * 그것이 무언가를 지킨다는 인상을 주는데, 이 데모가 지키는 것은 아무것도 없다.
 */

export interface DemoUser {
  id: string;
  name: string;
  /** "70대" · "상점"처럼 화면에 그대로 뜨는 짧은 표기. */
  ageBand: string;
  group: string;
  note: string;
}

export interface DemoPersonaAccount {
  id: string;
  /** 기관 계좌는 주인이 없다 — 받기만 하고 로그인 대상이 아니다. */
  ownerId: string | null;
  number: string;
  /** 주인이 부르는 이름 — 내 계좌 목록에 뜬다. */
  ownerLabel: string;
  /** 남이 부르는 이름 — 받는 분 목록과 거래내역에 뜬다. */
  nickname: string;
  bankCode: string;
  bankName: string;
  /** Spring 원장이 개시 분개로 넣는 금액. */
  opening: number;
  /** 브라우저 원장이 들고 시작하는 잔액 (거래내역이 이미 반영된 값). */
  balance: number;
}

export interface DemoHistoryEntry {
  from: string;
  to: string;
  amount: number;
  label: string;
  at: string;
}

export interface DemoAutoTransfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  payee: string;
  amount: number;
  dayOfMonth: number;
  active: boolean;
}

export interface DemoUpcomingDeposit {
  id: string;
  accountId: string;
  label: string;
  expectedAt: string;
  amount: number;
}

export const DEMO_GROUPS: readonly string[] = CONTRACT.groups;
export const DEMO_USERS: readonly DemoUser[] = CONTRACT.users;
export const DEMO_ACCOUNTS: readonly DemoPersonaAccount[] = CONTRACT.accounts;
export const DEMO_HISTORY: readonly DemoHistoryEntry[] = CONTRACT.history;
export const DEMO_AUTO_TRANSFERS: readonly DemoAutoTransfer[] = CONTRACT.autoTransfers;
export const DEMO_UPCOMING_DEPOSITS: readonly DemoUpcomingDeposit[] = CONTRACT.upcomingDeposits;

/**
 * 로그인하지 않았을 때의 사람.
 *
 * <p>기본값을 두는 것은 편의가 아니라 **호환**이다. 이 데모는 지금까지 김순자 한 사람이었고,
 * 기존 테스트와 계측 대본이 그 전제 위에 있다. 사용자를 안 넘기면 지금까지와 똑같이 돈다.
 */
export const DEFAULT_USER_ID = "u-1";

export function userById(userId: string): DemoUser | undefined {
  return DEMO_USERS.find((user) => user.id === userId);
}

export function accountById(accountId: string): DemoPersonaAccount | undefined {
  return DEMO_ACCOUNTS.find((account) => account.id === accountId);
}

/** 그 사람이 가진 계좌. 표에 적힌 순서를 그대로 지킨다 — 첫 계좌가 주거래다. */
export function accountsOf(userId: string): DemoPersonaAccount[] {
  return DEMO_ACCOUNTS.filter((account) => account.ownerId === userId);
}

/** 사람군 순서대로 묶는다. 로그인 화면이 이 순서로 줄을 세운다. */
export function usersByGroup(): Array<{ group: string; users: DemoUser[] }> {
  return DEMO_GROUPS.map((group) => ({
    group,
    users: DEMO_USERS.filter((user) => user.group === group),
  })).filter((row) => row.users.length > 0);
}

/**
 * 들어갈 수 있는 사람인가.
 *
 * <p>표에 있는 사람이면 <b>무엇을 눌렀든</b> 참이다. 전에는 여기서 여섯 자리를
 * 비교했는데, 비교할 값을 표에 적어 두는 것 자체가 "지켜진다"는 인상을 만들었다.
 * 이 데모가 지키는 것은 아무것도 없으므로 비교도 없앴다.
 */
export function canSignIn(userId: string): boolean {
  return userById(userId) !== undefined;
}
