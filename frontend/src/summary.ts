import type { Transaction } from "./api/types.js";

/**
 * 이번 달 돈이 어떻게 움직였는가, **두 문장으로** (AI-7).
 *
 * <p>거래 내역 화면은 지금 <b>줄의 목록</b>이다. 스무 줄을 훑어서 "이번 달에 얼마나
 * 나갔지"를 스스로 더하는 일은, 이 앱이 대상으로 삼는 사용자에게 정확히 어려운 종류의
 * 일이다. 화면이 답을 갖고 있는데 사용자가 계산하게 두는 것은 카드에 잔액을 안 얹고
 * "잔액 보기" 버튼만 두는 것과 같다 (기획안 S2).
 *
 * <p><b>여기에 모델이 없다.</b> 합계는 원장에서 나오고, 문장은 그 합계로 조립된다.
 * `nextSteps`가 LLM을 안 쓰는 이유와 같다 — 답이 이미 데이터 안에 있고, 결정론이면
 * 같은 달에 늘 같은 문장이 나온다. 돈을 말하는 문장이 열 때마다 달라지면 그것은
 * 도움이 아니라 불안이다.
 *
 * <p>모델이 붙을 자리는 <b>말투</b>뿐이고, 그것도 숫자는 앱이 채운다 (`confirm.ts`와
 * 같은 구조). 지금은 붙이지 않았다 — 이 문장은 이미 충분히 쉽고, 매달 달라질 이유가 없다.
 */

export interface MonthlySummary {
  /** 이번 달 나간 돈의 합계 */
  spent: number;
  /** 이번 달 들어온 돈의 합계 */
  received: number;
  /** 가장 큰 지출의 상대. 없으면 `null` */
  largestPayee: string | null;
  largestAmount: number;
  /** 이번 달 거래 건수. 0이면 화면은 아무것도 그리지 않는다. */
  count: number;
}

/**
 * 이번 달 거래만 골라 더한다.
 *
 * @param now 기준 시각. **주입한다** — 테스트가 "이번 달"을 고정할 수 있어야 하고,
 *   그것은 `packages/core`가 `Date.now()`를 안 부르는 이유와 같다.
 */
export function summarizeMonth(
  transactions: readonly Transaction[],
  now: Date = new Date(),
): MonthlySummary {
  const year = now.getFullYear();
  const month = now.getMonth();

  const thisMonth = transactions.filter((entry) => {
    const at = new Date(entry.at);
    if (Number.isNaN(at.getTime())) return false;
    return at.getFullYear() === year && at.getMonth() === month;
  });

  let spent = 0;
  let received = 0;
  let largestPayee: string | null = null;
  let largestAmount = 0;

  for (const entry of thisMonth) {
    if (entry.direction === "out") {
      spent += entry.amount;
      if (entry.amount > largestAmount) {
        largestAmount = entry.amount;
        largestPayee = entry.counterparty;
      }
    } else {
      received += entry.amount;
    }
  }

  return { spent, received, largestPayee, largestAmount, count: thisMonth.length };
}

/**
 * 합계를 사람이 읽는 두 문장으로.
 *
 * <p><b>비교하지 않는다.</b> "지난달보다 많이 쓰셨어요" 같은 말은 판단이고, 이 앱은
 * 사용자의 씀씀이를 평가하는 자리가 아니다. 사실만 말하고 판단은 사용자에게 남긴다 —
 * 안심 점검이 "사기입니다" 대신 "처음 보내시네요"라고 말하는 것과 같은 규칙이다.
 *
 * @param format 통화 표기. 호스트가 준다.
 */
export function summaryText(
  summary: MonthlySummary,
  format: (amount: number) => string,
): string[] {
  if (summary.count === 0) return [];

  const lines = [`이번 달에 ${format(summary.spent)}이 나갔어요.`];
  if (summary.largestPayee) {
    lines.push(`가장 큰 것은 ${summary.largestPayee} ${format(summary.largestAmount)}이에요.`);
  }
  if (summary.received > 0) {
    lines.push(`들어온 돈은 ${format(summary.received)}이에요.`);
  }
  return lines;
}
