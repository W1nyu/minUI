import { describe, expect, it } from "vitest";
import { calendarFields } from "../src/calendar.js";

const KST = 540;

describe("calendarFields — Date 없이 순수 산술로 달력 필드를 뽑는다", () => {
  it("UTC 기준 필드를 정확히 계산한다", () => {
    expect(calendarFields(Date.UTC(2026, 0, 15, 10, 30), 0)).toMatchObject({
      year: 2026,
      month: 1,
      dayOfMonth: 15,
      weekday: 4, // 목요일
      hour: 10,
    });
  });

  it("타임존 오프셋을 반영해 날짜가 넘어간다", () => {
    // 2026-01-15 20:00 UTC = 2026-01-16 05:00 KST
    expect(calendarFields(Date.UTC(2026, 0, 15, 20, 0), KST)).toMatchObject({
      year: 2026,
      month: 1,
      dayOfMonth: 16,
      weekday: 5,
      hour: 5,
    });
  });

  it("윤년 2월 29일을 처리한다", () => {
    expect(calendarFields(Date.UTC(2028, 1, 29, 12, 0), 0)).toMatchObject({
      year: 2028,
      month: 2,
      dayOfMonth: 29,
    });
  });

  it("epoch 이전 시각에서도 무너지지 않는다", () => {
    expect(calendarFields(Date.UTC(1969, 11, 31, 23, 0), 0)).toMatchObject({
      year: 1969,
      month: 12,
      dayOfMonth: 31,
      weekday: 3, // 수요일
      hour: 23,
    });
  });

  it("표준 Date와 결과가 일치한다 (오프셋 0 기준, 무작위 표본)", () => {
    for (let i = 0; i < 500; i++) {
      const ms = Math.floor((Math.random() - 0.3) * 2e12);
      const d = new Date(ms);
      expect(calendarFields(ms, 0)).toMatchObject({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        dayOfMonth: d.getUTCDate(),
        weekday: d.getUTCDay(),
        hour: d.getUTCHours(),
      });
    }
  });

  it("기간 인덱스는 서로 다른 달/주/일을 구분한다", () => {
    const jan15 = calendarFields(Date.UTC(2026, 0, 15, 10), 0);
    const jan16 = calendarFields(Date.UTC(2026, 0, 16, 10), 0);
    const feb15 = calendarFields(Date.UTC(2026, 1, 15, 10), 0);

    expect(jan16.dayIndex).toBe(jan15.dayIndex + 1);
    expect(feb15.monthIndex).toBe(jan15.monthIndex + 1);
    expect(feb15.weekIndex).toBeGreaterThan(jan15.weekIndex);
    // 같은 날의 다른 시각은 같은 날로 센다
    expect(calendarFields(Date.UTC(2026, 0, 15, 23), 0).dayIndex).toBe(jan15.dayIndex);
  });
});
