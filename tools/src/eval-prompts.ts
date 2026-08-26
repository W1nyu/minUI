import { normalize } from "@minui/core";
import { sharedRun } from "./eval-contamination.js";

/**
 * 정답의 글자를 가린 **문항지 봉투**를 만든다 (M11 Task 13).
 *
 * <h3>무엇을 고치려는 것인가</h3>
 * 기획안 §0: <b>"질의도 내가 쓰고 동의어도 내가 썼다."</b> 고치려면 질의를 쓰는 사람이
 * 정답의 글자를 본 적이 없어야 한다. 그런데 무엇을 하는 화면인지는 알려 줘야 질의를
 * 쓸 수 있다 — 그래서 설명이 필요하고, <b>그 설명이 새로운 누출 통로가 된다.</b>
 *
 * <p>설명에 라벨이나 동의어의 글자가 들어 있으면 참가자가 그것을 따라 쓴다. 그러면
 * 새 세트가 같은 오염을 그대로 재현한다 — 사람만 바꾸고 문제는 그대로인 셈이다.
 * 그래서 <b>설명을 코드가 검사한다.</b> "이건 안 흘리는 것 같다"고 사람이 고르면
 * 그 판단이 또 오염이다.
 *
 * <h3>고르는 것 자체가 편향이라는 사실</h3>
 * 이 필터를 통과하는 메뉴는 <b>라벨과 설명의 글자가 겹치지 않는 것들</b>이다. 즉
 * `수신`을 "돈 맡기는 것"이라 설명해야 하는 종류가 남고, `펀드몰`처럼 이름이 곧
 * 설명인 것은 빠진다. 이것은 흠이 아니라 <b>겨냥</b>이다 — 사용자가 라벨의 말을 쓰지
 * 않는 화면이 정확히 M11이 재고 싶은 것이다. 다만 <b>그래서 이 세트의 결과를
 * "전체 메뉴에서의 성능"으로 읽으면 안 된다.</b> 프로토콜 문서에 그대로 적는다.
 */

export interface EnvelopeInput {
  menuId: string;
  label: string;
  /** 정답으로 인정될 모든 표현 (라벨 + 사람 동의어). 파이프라인이 보는 것과 같아야 한다. */
  terms: readonly string[];
  /** 뜻풀이. 없으면 봉투를 만들 수 없다. */
  hint?: string | undefined;
  /** 갈래. 봉투에 함께 찍히므로 이것도 검사 대상이다. */
  path: readonly string[];
}

export interface Envelope {
  menuId: string;
  usable: boolean;
  /** 참가자에게 보일 설명. 못 쓰는 봉투에는 없다. */
  description?: string;
  /** 참가자에게 보일 갈래. 흘리는 조각은 빠진다. */
  context?: string[];
  reason?: string;
}

export function makeEnvelope(input: EnvelopeInput): Envelope {
  const hint = input.hint?.trim();
  if (!hint) {
    return { menuId: input.menuId, usable: false, reason: "뜻풀이가 없다" };
  }

  const terms = [input.label, ...input.terms].filter((t) => t.length > 0);

  if (leaks(hint, terms)) {
    return { menuId: input.menuId, usable: false, reason: "설명이 정답의 글자를 흘린다" };
  }

  /*
   * 갈래도 검사한다. 봉투에 함께 찍히므로 설명이 깨끗해도 갈래가 흘리면 소용없다.
   * 흘리는 조각만 빼고 나머지는 남긴다 — 갈래가 통째로 사라지면 참가자가 어느 영역의
   * 이야기인지 몰라 엉뚱한 질의를 쓴다.
   */
  const context = input.path.filter((segment) => !leaks(segment, terms));

  return { menuId: input.menuId, usable: true, description: hint, context };
}

/**
 * 이 글이 정답의 글자를 흘리는가.
 *
 * <p><b>통째 포함이 아니라 조각을 본다.</b> "새로 나온 <b>펀드</b> 상품"은 `신상펀드`를
 * 통째로 담고 있지 않지만 참가자는 눈에 띄는 조각을 따라 쓴다 — 그러면 새 세트가 같은
 * 오염을 재현한다.
 *
 * <p>2자를 문턱으로 삼는 것은 파이프라인의 포함 판정이 한 글자를 빼는 것과 같은
 * 기준이다. <b>재는 눈이 재는 대상과 같아야 한다.</b> §0이 3자 이상만 세는 바람에
 * 자기 오염을 49%로 적었지만 실제는 59%였던 것이 그 예다 (`report:contamination` ①').
 */
function leaks(text: string, terms: readonly string[]): boolean {
  return sharedRun(text, terms) >= 2;
}

/**
 * 설명이 서로 너무 닮은 문항을 걷어낸다.
 *
 * <p>실제로 뽑아 보니 "물건 살 때 안전 결제 확인"과 "안전결제 거래가 잘 되었는지
 * 확인합니다"가 나란히 나왔다. 참가자에게는 <b>같은 질문을 두 번 하는 것</b>으로 읽히고,
 * 둘에 다른 답을 쓰려고 애쓰다 평소 안 쓰는 말이 나온다 — 그것은 잰 값이 아니다.
 *
 * <p>먼저 온 것을 남긴다. `pickEvenly`가 이미 고르게 뽑아 놨으므로 순서에 의미가 있다.
 *
 * <p>판정은 <b>공유 덩어리 비율</b>이다 — 둘이 같은 말 덩어리를 나눠 갖고, 그것이 짧은
 * 쪽의 상당 부분을 차지하면 같은 질문으로 본다. 실측값이 깨끗하게 갈렸다:
 * <pre>
 *   "물건 살 때 안전 결제 확인" / "안전결제 거래가 잘 되었는지 확인"   덩어리 4자 / 10자 = 0.40
 *   "잔액을 확인하는 화면"     / "잔액을 확인하는 곳"                덩어리 5자 /  6자 = 0.83
 *   "돈을 맡겨 두는 것"        / "남에게 돈을 보내는 일"              덩어리 0자        = 0
 * </pre>
 * 자카드도 갈리긴 했지만(0.25 / 0.57 / 0.00) 뜻이 덜 분명해서 쓰지 않았다.
 */
export function dropNearDuplicates(
  descriptions: readonly string[],
  minRatio = 0.3,
  minRun = 3,
): number[] {
  const kept: number[] = [];
  const keptText: string[] = [];

  descriptions.forEach((description, index) => {
    const similar = keptText.some((previous) => {
      const run = sharedRun(description, [previous]);
      if (run < minRun) return false;
      const shorter = Math.min(normalize(description).length, normalize(previous).length);
      return shorter > 0 && run / shorter >= minRatio;
    });
    if (similar) return;
    kept.push(index);
    keptText.push(description);
  });

  return kept;
}

/**
 * 풀에서 고르게 뽑는다. **앞에서 자르지 않는다.**
 *
 * <p>카탈로그 순서는 수집 당시의 DOM 순서라 앞쪽에 상위 갈래와 첫 화면 메뉴가 몰려 있다.
 * `slice(0, n)`으로 자르면 문항이 한 영역에 쏠린다.
 *
 * <p>난수를 쓰지 않는 이유: <b>문항지를 다시 뽑아도 같아야 한다.</b> 참가자마다 다른
 * 문항을 받으면 결과를 합칠 수 없고, 다시 돌렸을 때 달라지면 무엇을 물었는지 재현할 수 없다.
 */
export function pickEvenly<T>(pool: readonly T[], count: number): T[] {
  if (count >= pool.length) return [...pool];
  if (count <= 0) return [];

  const step = pool.length / count;
  const picked: T[] = [];
  for (let i = 0; i < count; i++) picked.push(pool[Math.floor(i * step)]!);
  return picked;
}
