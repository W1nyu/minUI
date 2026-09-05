import { countConfusions, normalize, pronounce, type ConfusionCosts } from "@minui/core";
import type { CorpusRow } from "./corpus.js";

/**
 * 코퍼스 줄에서 자모 혼동 비용을 만든다 (M21).
 *
 * <p>`fit:confusion`(표를 파일로 굽는다)과 `bench:voice`(교차검증으로 접힘마다 다시
 * 배운다)가 <b>같은 함수</b>를 쓴다. 두 벌로 두면 파일에 구운 표와 벤치가 잰 표가
 * 달라지고, 그러면 벤치 수치가 배포될 표를 설명하지 못한다.
 */

/**
 * 더하기 평활 상수. 한 번 본 혼동이 곧바로 확신이 되지 않게 누른다.
 *
 * <p>표본이 수백 줄 규모라 <b>1보다 크게</b> 잡았다. 재서 고른 값이 아니라 보수적으로
 * 놓은 것이고, 코퍼스가 커지면 다시 볼 자리다.
 */
const ALPHA = 2;

/** 자모 종류 수의 대략치. 초성 19 + 중성 21 + 종성 27. */
const VOCAB = 67;

/**
 * 배운 혼동이라도 공짜가 되지는 않는다.
 *
 * <p>비용이 0이면 두 자모가 <b>같은 소리가 되어</b> 서로 다른 메뉴를 구별할 수 없다.
 * "자주 헷갈린다"는 "같다"가 아니다.
 */
const MIN_COST = 0.15;

/** 이 횟수 미만으로 본 혼동은 표에 넣지 않는다. 한 번은 우연일 수 있다. */
const MIN_COUNT = 2;

/**
 * 소리로 옮긴 짝.
 *
 * <p>둘 다 `normalize` → `pronounce`를 지난다. 표기 규칙의 차이를 먼저 걷어 내야
 * 남는 것이 <b>오인식</b>이다. 이 코퍼스에서 인식 결과의 70%는 띄어쓰기만 달랐고,
 * 그것은 `normalize`가 지운다.
 */
function toSoundPair(row: CorpusRow): { intended: string; heard: string } {
  return {
    intended: pronounce(normalize(row.intended)),
    heard: pronounce(normalize(row.heard)),
  };
}

/** 표에 실린 항목 하나 — 리포트가 쓴다. */
export interface FittedEntry {
  key: string;
  count: number;
  cost: number;
}

export interface Fitted {
  costs: ConfusionCosts;
  /** 본 횟수 순으로 정렬된 치환들. */
  top: FittedEntry[];
}

/**
 * 확률을 비용으로 옮긴다.
 *
 * <pre>
 *   p        = (본 횟수 + α) / (그 자모가 나온 횟수 + α·|V|)
 *   p_unseen = α / (그 자모가 나온 횟수 + α·|V|)
 *   cost     = log(p) / log(p_unseen)      ← 둘 다 음수라 결과는 양수
 * </pre>
 *
 * <p>한 번도 못 본 혼동은 정확히 1이 되어 <b>균일 편집거리와 같아진다.</b> 자주 본 혼동만
 * 1 아래로 내려온다. 이 사다리가 "표가 비면 지금과 값이 같다"는 성질을 유지시킨다.
 */
function costOf(count: number, observed: number): number {
  const denominator = observed + ALPHA * VOCAB;
  const p = (count + ALPHA) / denominator;
  const unseen = ALPHA / denominator;
  return Math.max(MIN_COST, Math.min(1, Math.log(p) / Math.log(unseen)));
}

/** 주어진 줄들에서만 배운다. 부르는 쪽이 무엇을 넘길지 정한다. */
export function fitCosts(rows: readonly CorpusRow[]): Fitted {
  const tally = countConfusions(rows.map(toSoundPair));

  const costs: ConfusionCosts = {
    subs: {},
    ins: {},
    del: {},
    defaultSub: 1,
    defaultIns: 1,
    defaultDel: 1,
  };
  const top: FittedEntry[] = [];

  for (const [key, count] of tally.subs) {
    if (count < MIN_COUNT) continue;
    const intended = key.split(">")[0]!;
    const cost = costOf(count, tally.observed.get(intended) ?? count);
    if (cost >= 1) continue;
    costs.subs[key] = Number(cost.toFixed(3));
    top.push({ key, count, cost });
  }

  for (const [jamo, count] of tally.del) {
    if (count < MIN_COUNT) continue;
    const cost = costOf(count, tally.observed.get(jamo) ?? count);
    if (cost < 1) costs.del[jamo] = Number(cost.toFixed(3));
  }

  const insTotal = [...tally.ins.values()].reduce((sum, value) => sum + value, 0);
  for (const [jamo, count] of tally.ins) {
    if (count < MIN_COUNT) continue;
    const cost = costOf(count, insTotal);
    if (cost < 1) costs.ins[jamo] = Number(cost.toFixed(3));
  }

  top.sort((a, b) => b.count - a.count);
  return { costs, top };
}
