import {
  calendarFields,
  circularDayDistance,
  circularHourDistance,
} from "./calendar.js";
import type { MinUIConfig } from "./config.js";
import type { Visit } from "./types.js";

/**
 * 상황 항 (기획안 §8.1 `contextBoost`). 결과는 0..1.
 *
 * 세 축 — 월 주기, 요일, 시간대 — 각각 "지금 조건에 맞는 사용이 얼마나 되는가"를 본다.
 * 학습 모델을 쓰지 않는 이유는 데이터가 사용자 한 명분이라 학습이 성립하지 않기 때문이다.
 *
 * 잡음을 패턴으로 오인하지 않기 위해 두 겹의 방어를 둔다.
 *
 *  ① **서로 다른 기간에서 관측했는가.** 오늘 하루 여섯 번 들어간 메뉴는 오늘과 날짜도
 *     요일도 당연히 일치한다. 그것을 "매달 그날 쓰는 패턴"으로 세면 방금 만진 메뉴가
 *     전부 주기성을 얻는다. 그래서 축마다 서로 다른 달/주/일의 수를 세고,
 *     그 수가 모자라면 해당 축은 0을 낸다.
 *
 *  ② **우연 기저선을 뺀다.** 아무 패턴 없이 흩어진 사용도 요일 축에서는 1/7 확률로
 *     오늘과 겹친다. 그 몫을 그대로 주면 모든 메뉴가 공짜 가산점을 받는다.
 *
 * 분모는 항상 세 축 가중치의 합이다. 관측이 부족한 축을 분모에서 빼면 근거가 적은 쪽이
 * 오히려 만점을 받게 되므로, 가중치는 "각 축이 낼 수 있는 최대 기여"로 해석한다.
 */
export function contextBoost(
  visits: readonly Visit[],
  now: number,
  config: MinUIConfig,
): number {
  const {
    minObservations,
    monthlyDayTolerance,
    hourTolerance,
    weights,
    utcOffsetMinutes,
  } = config.context;

  const totalWeight = weights.monthly + weights.weekday + weights.hourOfDay;
  if (totalWeight <= 0 || visits.length < minObservations) return 0;

  const today = calendarFields(now, utcOffsetMinutes);

  // 축마다 "서로 다른 기간"을 세되, 같은 기간 안에서 한 번이라도 조건에 맞으면 맞은 것으로 본다.
  const months = new Map<number, boolean>();
  const weeks = new Map<number, boolean>();
  const days = new Map<number, boolean>();

  for (const visit of visits) {
    const f = calendarFields(visit.at, utcOffsetMinutes);

    mark(
      months,
      f.monthIndex,
      circularDayDistance(f.dayOfMonth, today.dayOfMonth) <= monthlyDayTolerance,
    );
    mark(weeks, f.weekIndex, f.weekday === today.weekday);
    mark(days, f.dayIndex, circularHourDistance(f.hour, today.hour) <= hourTolerance);
  }

  const monthly = axisScore(months, minObservations, (2 * monthlyDayTolerance + 1) / 31);
  const weekday = axisScore(weeks, minObservations, 1 / 7);
  const hourOfDay = axisScore(days, minObservations, (2 * hourTolerance + 1) / 24);

  return (
    (weights.monthly * monthly +
      weights.weekday * weekday +
      weights.hourOfDay * hourOfDay) /
    totalWeight
  );
}

function mark(buckets: Map<number, boolean>, key: number, hit: boolean): void {
  buckets.set(key, (buckets.get(key) ?? false) || hit);
}

/** 관측 기간이 모자라면 0. 충분하면 우연 대비 초과분만 0..1로 편다. */
function axisScore(
  buckets: Map<number, boolean>,
  minObservations: number,
  chance: number,
): number {
  if (buckets.size < minObservations || chance >= 1) return 0;

  let hits = 0;
  for (const hit of buckets.values()) if (hit) hits += 1;

  return Math.max(0, (hits / buckets.size - chance) / (1 - chance));
}
