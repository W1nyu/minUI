/**
 * epoch ms → 달력 필드. `Date`를 쓰지 않는다.
 *
 * 이유가 둘이다.
 *  ① `Date`의 로컬 메서드는 실행 환경의 타임존에 따라 결과가 달라져, 같은 입력이
 *     기기마다 다른 카드 배치를 만들 수 있다. 오프셋을 명시적으로 받으면 결정론적이다.
 *  ② 순수 산술이라 다른 언어로 그대로 옮겨진다.
 */

const DAY_MS = 86_400_000;

export interface CalendarFields {
  year: number;
  /** 1~12 */
  month: number;
  /** 1~31 */
  dayOfMonth: number;
  /** 0=일 ~ 6=토 */
  weekday: number;
  /** 0~23 */
  hour: number;
  /** epoch 기준 일련 일자. 서로 다른 날인지 판단할 때 쓴다. */
  dayIndex: number;
  /** 서로 다른 주인지 판단할 때 쓴다. */
  weekIndex: number;
  /** 서로 다른 달인지 판단할 때 쓴다. */
  monthIndex: number;
}

export function calendarFields(
  epochMs: number,
  utcOffsetMinutes: number,
): CalendarFields {
  const shifted = epochMs + utcOffsetMinutes * 60_000;
  const dayIndex = Math.floor(shifted / DAY_MS);
  const msOfDay = shifted - dayIndex * DAY_MS; // floor를 썼으므로 음수 시각에서도 0 이상

  const { year, month, day } = civilFromDays(dayIndex);

  return {
    year,
    month,
    dayOfMonth: day,
    // 1970-01-01은 목요일(4)이다.
    weekday: (((dayIndex + 4) % 7) + 7) % 7,
    hour: Math.floor(msOfDay / 3_600_000),
    dayIndex,
    weekIndex: Math.floor(dayIndex / 7),
    monthIndex: year * 12 + (month - 1),
  };
}

/**
 * Howard Hinnant의 civil_from_days.
 * 3월을 한 해의 시작으로 옮겨 윤일을 마지막에 두는 방식이라 윤년 분기가 필요 없다.
 */
function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719_468; // 0000-03-01 기준으로 이동
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097; // 0..146096
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153); // 0=3월 ... 11=2월
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);

  return { year, month, day };
}

/** 두 날짜(1~31)의 순환 거리. 31일과 1일은 하루 차이로 본다. */
export function circularDayDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 31 - diff);
}

/** 두 시각(0~23)의 순환 거리. 23시와 0시는 한 시간 차이로 본다. */
export function circularHourDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 24 - diff);
}
