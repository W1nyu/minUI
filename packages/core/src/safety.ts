import { calendarFields } from "./calendar.js";
import type { MinUIConfig } from "./config.js";

/**
 * 보내기 직전에 세우는 문들 (F13).
 *
 * <p>이 파일이 하는 일은 **막는 것이 아니라 읽게 하는 것**이다. 어떤 점검도 이체를
 * 취소하지 않고, 어떤 점검도 확인 단계를 없애지 않는다. 위험도를 <b>올리기만</b> 하는
 * `combineRisk`와 같은 방향이고 같은 이유다 (절대 보호선 규칙 8).
 *
 * <p><b>말을 여기서 정하지 않는다.</b> 돌려주는 것은 `{kind, level}`과 화면이 문장을
 * 만들 때 쓸 값 몇 개뿐이고, 한국어 문장은 `packages/react`가 만든다. `validateProposal`이
 * 라벨을 카탈로그에서만 가져오는 것과 같은 판단이다 — 말이 코어에 박히면 다른 언어로
 * 포팅할 때 규칙과 문장이 함께 끌려간다.
 *
 * <p><b>코어는 원장도 계좌도 모른다.</b> 판단에 필요한 사실은 호스트가 화면 안의 값으로
 * 채워 넘긴다(`TransferFacts`). 그래서 여기 저장도 네트워크도 없고, 넘어온 값은 이 함수가
 * 끝나면 사라진다 — 수집 금지 데이터(계좌번호·금액·수취인)를 <b>보긴 하되 남기지 않는</b>
 * 자리다 (기획안 §11.1).
 */

/** 무엇이 걸렸는가. 닫힌 집합이다 — 늘리려면 여기 적고 늘린다. */
export type SafetyKind =
  /** 이 기기의 기록에 없는 사람에게 처음 보낸다 */
  | "first-time-payee"
  /** 평소 보내던 금액보다 크다 */
  | "larger-than-usual"
  /** 사용자의 달력으로 늦은 밤이다 */
  | "late-night"
  /**
   * 방금 같은 사람에게 같은 금액을 보냈다.
   *
   * <p>이름에 `window`를 쓰지 않은 이유가 있다 — `portability.test.ts`가 코어 안의
   * 브라우저 전역을 문자열로 찾는데, 그 검사에 걸린다. 검사를 느슨하게 만드는 것보다
   * 이름을 바꾸는 편이 낫다.
   */
  | "sent-again-soon"
  /** 목록에 같은 이름의 받는 분이 또 있다 */
  | "same-name-payee"
  /** 보내고 나면 잔액이 거의 남지 않는다 */
  | "drains-balance";

/**
 * 얼마나 세게 말할 것인가. **둘뿐이다.**
 *
 * <p>`stop`이라도 이체를 막지는 않는다 — 화면이 확인 표시를 하나 더 받을 뿐이다.
 * 단계를 더 늘리면 사람은 읽지 않고 누르는 법을 배운다. 그래서 셋으로 나누지 않았다.
 */
export type SafetyLevel = "notice" | "stop";

export interface SafetyNote {
  kind: SafetyKind;
  level: SafetyLevel;
  /**
   * 화면이 문장을 채울 때 쓸 값. **숫자를 문장으로 만드는 일은 화면이 한다** —
   * 통화 표기는 호스트의 것이고 코어가 정할 것이 아니다.
   */
  detail?: {
    /** `larger-than-usual` — 평소 보내던 금액(지난 기록의 최댓값) */
    usualAmount?: number;
    /** `drains-balance` — 보내고 남는 돈 */
    remainingBalance?: number;
  };
}

/** 지난 이체 하나. **상대와 금액과 시각뿐이다** — 계좌번호는 여기 오지 않는다. */
export interface PastTransfer {
  payeeId: string;
  amount: number;
  at: number;
}

export interface TransferFacts {
  payeeId: string;
  payeeName: string;
  amount: number;
  /** 보내기 전 잔액 */
  balance: number;
  /** 주입된 시각. `Date.now()`를 부르지 않는다 (불변 규칙 1). */
  now: number;
  /** 이 기기가 아는 지난 이체. 없으면 빈 배열 */
  history: readonly PastTransfer[];
  /** 받는 분 목록의 이름들. 같은 이름이 둘인지 보려고 받는다 */
  payeeNames: readonly string[];
}

/**
 * `stop`이 먼저, 그다음은 고정된 차례.
 *
 * <p>정렬 기준을 점수가 아니라 <b>고정 순서</b>로 둔 이유는 §8.2와 같다 — 같은 상황에서
 * 늘 같은 순서로 보여야 사용자가 두 번째부터 읽지 않고도 안다.
 */
const ORDER: readonly SafetyKind[] = [
  "same-name-payee",
  "sent-again-soon",
  "larger-than-usual",
  "first-time-payee",
  "drains-balance",
  "late-night",
];

/**
 * 보낼 내용을 보고 걸리는 것을 모은다. **아무것도 안 걸리면 빈 배열이다.**
 *
 * <p>빈 배열이 정상이라는 것이 중요하다. 매번 무언가 뜨면 그것은 경고가 아니라 배경이
 * 된다 — 늘 켜져 있는 빨간 등은 아무도 안 본다.
 */
export function checkTransfer(facts: TransferFacts, config: MinUIConfig): SafetyNote[] {
  const rules = config.safety;
  const notes: SafetyNote[] = [];

  if (facts.amount <= 0) return notes;

  // ① 같은 이름이 둘 — 이름만 보고 고르면 틀린다.
  const sameName = facts.payeeNames.filter(
    (name) => name.trim() === facts.payeeName.trim(),
  ).length;
  if (sameName > 1) notes.push({ kind: "same-name-payee", level: "stop" });

  const toThisPayee = facts.history.filter((past) => past.payeeId === facts.payeeId);

  // ② 방금 같은 곳에 같은 금액 — 두 번 눌린 것일 수 있다.
  const justSent = toThisPayee.some(
    (past) =>
      past.amount === facts.amount &&
      facts.now - past.at >= 0 &&
      facts.now - past.at <= rules.repeatWindowMs,
  );
  if (justSent) notes.push({ kind: "sent-again-soon", level: "stop" });

  /*
   * ③ 평소보다 크다.
   *
   * **기록이 적으면 "평소"를 말하지 않는다.** 한 번 보낸 것을 평소라고 부르면 두 번째
   * 이체가 늘 경고를 받는다. 그때는 절대 기준(`largeAmountFloor`)만 본다 — 기록이 없어도
   * 큰 금액은 큰 금액이다.
   */
  const usualAmount = toThisPayee.length >= rules.minHistoryForUsual
    ? Math.max(...toThisPayee.map((past) => past.amount))
    : null;
  const overUsual = usualAmount !== null && facts.amount > usualAmount * rules.largeAmountRatio;
  const overFloor = usualAmount === null && facts.amount >= rules.largeAmountFloor;
  if (overUsual || overFloor) {
    notes.push({
      kind: "larger-than-usual",
      level: "stop",
      ...(usualAmount !== null ? { detail: { usualAmount } } : {}),
    });
  }

  // ④ 처음 보내는 분. 그 자체로는 이상한 일이 아니라 `notice`다.
  if (toThisPayee.length === 0) notes.push({ kind: "first-time-payee", level: "notice" });

  // ⑤ 보내고 나면 얼마 안 남는다.
  const remainingBalance = facts.balance - facts.amount;
  if (
    facts.balance > 0 &&
    remainingBalance >= 0 &&
    remainingBalance < facts.balance * rules.lowBalanceRatio
  ) {
    notes.push({ kind: "drains-balance", level: "notice", detail: { remainingBalance } });
  }

  /*
   * ⑥ 늦은 밤. **사용자의 달력으로 본다** — 시스템 타임존을 읽지 않는다(불변 규칙 1).
   *
   * 자정을 넘어가는 구간이라 `from > to`인 경우를 따로 다룬다.
   */
  const { hour } = calendarFields(facts.now, config.context.utcOffsetMinutes);
  const { lateNightFromHour: from, lateNightToHour: to } = rules;
  const isLateNight = from > to ? hour >= from || hour < to : hour >= from && hour < to;
  if (isLateNight) notes.push({ kind: "late-night", level: "notice" });

  return notes.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/**
 * 확인 표시를 하나 더 받아야 하는가.
 *
 * <p>`requiresConfirm`과 나란히 두고 읽을 함수다. 저쪽은 <b>메뉴</b>의 위험도를 보고
 * 이쪽은 <b>이번 한 번</b>의 내용을 본다. 둘 중 하나라도 참이면 확인을 받는다.
 */
export function requiresExtraConfirm(notes: readonly SafetyNote[]): boolean {
  return notes.some((note) => note.level === "stop");
}
