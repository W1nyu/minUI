import { describe, expect, it } from "vitest";
import { buildReport, median } from "../src/usertest-report.js";
import type { Mode, Session, TaskRun } from "../src/usertest-session.js";

function run(taskId: string, mode: Mode, elapsedMs: number, completed = true): TaskRun {
  return {
    taskId,
    mode,
    targetMenuId: "inquiry.balance",
    startedAt: 0,
    endedAt: elapsedMs,
    elapsedMs,
    taps: 1,
    screens: [],
    offTarget: 0,
    completed,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    participant: "P01",
    ageBand: "60+",
    firstMode: "minui",
    runs: [],
    interventions: {},
    words: {},
    ...overrides,
  };
}

describe("median", () => {
  it("표본이 없으면 null이다 — 0이 아니다", () => {
    expect(median([])).toBeNull();
  });

  it("홀수 개는 가운데 값이다", () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it("짝수 개는 가운데 둘의 평균이다", () => {
    expect(median([40, 10, 20, 30])).toBe(25);
  });
});

describe("buildReport", () => {
  it("참가자 수를 연령대별로 센다", () => {
    const report = buildReport([
      session({ participant: "P01", ageBand: "60+" }),
      session({ participant: "P02", ageBand: "40-50" }),
      session({ participant: "P03", ageBand: "60+" }),
    ]);

    expect(report.participants).toBe(3);
    expect(report.byAgeBand["60+"]).toBe(2);
    expect(report.byAgeBand["40-50"]).toBe(1);
  });

  it("완료 시간은 완료한 수행만 센다", () => {
    const report = buildReport([
      session({ runs: [run("T1", "minui", 10_000), run("T1", "minui", 900_000, false)] }),
    ]);

    const t1 = report.tasks.find((task) => task.taskId === "T1")!;
    expect(t1.minui.samplesMs).toEqual([10_000]);
    expect(t1.minui.medianMs).toBe(10_000);
    expect(t1.minui.attempted).toBe(2);
    expect(t1.minui.completed).toBe(1);
  });

  // 중단은 미완료이므로 위 규칙이 이미 시간을 뺀다. 여기서는 중단 수를 따로 세는지 본다.
  it("진행자가 중단시킨 수행을 따로 센다", () => {
    const report = buildReport([
      session({
        runs: [run("T2", "classic", 180_000, false)],
        interventions: { "T2:classic": 3 },
      }),
    ]);

    const t2 = report.tasks.find((task) => task.taskId === "T2")!;
    expect(t2.classic.aborted).toBe(1);
    expect(t2.classic.samplesMs).toEqual([]);
    expect(t2.classic.medianMs).toBeNull();
  });

  it("개입을 받고 완료한 수행을 따로 센다 — 그 시간에는 힌트가 실려 있다", () => {
    const report = buildReport([
      session({ runs: [run("T3", "minui", 50_000)], interventions: { "T3:minui": 2 } }),
      session({ participant: "P02", runs: [run("T3", "minui", 30_000)] }),
    ]);

    const t3 = report.tasks.find((task) => task.taskId === "T3")!;
    expect(t3.minui.assisted).toBe(1);
    expect(t3.minui.samplesMs).toEqual([30_000, 50_000]);
  });

  it("T2-repeat와 F9는 1차 지표에서 뺀다", () => {
    const report = buildReport([
      session({
        runs: [
          run("T2", "minui", 20_000),
          run("T2-repeat", "minui", 5_000),
          run("F9", "minui", 9_000),
        ],
      }),
    ]);

    expect(report.tasks.map((task) => task.taskId)).toEqual(["T1", "T2", "T3"]);
    const t2 = report.tasks.find((task) => task.taskId === "T2")!;
    expect(t2.minui.samplesMs).toEqual([20_000]);
  });

  it("오탐색률은 수행당 평균이다", () => {
    const first = run("T2", "classic", 20_000);
    first.offTarget = 3;
    const second = run("T2", "classic", 20_000);
    second.offTarget = 1;

    const report = buildReport([session({ runs: [first, second] })]);

    expect(report.tasks.find((task) => task.taskId === "T2")!.classic.offTargetPerRun).toBe(2);
  });

  it("완료율은 모드별로 모든 과제를 합쳐 센다", () => {
    const report = buildReport([
      session({
        runs: [
          run("T1", "minui", 10_000),
          run("T2", "minui", 10_000, false),
          run("T3", "minui", 10_000),
          run("T1", "classic", 10_000),
        ],
      }),
    ]);

    expect(report.completion.minui).toEqual({ completed: 2, attempted: 3 });
    expect(report.completion.classic).toEqual({ completed: 1, attempted: 1 });
  });

  it("순서 효과를 참가자의 firstMode로 가른다", () => {
    const report = buildReport([
      // 쉬운 모드를 먼저 한 사람 — minui가 '먼저', classic이 '나중'
      session({
        participant: "P01",
        firstMode: "minui",
        runs: [run("T1", "minui", 60_000), run("T1", "classic", 20_000)],
      }),
      // 기본 UI를 먼저 한 사람 — classic이 '먼저', minui가 '나중'
      session({
        participant: "P02",
        firstMode: "classic",
        runs: [run("T1", "classic", 40_000), run("T1", "minui", 10_000)],
      }),
    ]);

    expect(report.order.firstMedianMs).toBe(50_000);
    expect(report.order.secondMedianMs).toBe(15_000);
  });

  it("F9 세 갈래와 M7 반복을 센다", () => {
    const report = buildReport([
      session({ participant: "P01", f9: "read-not-tapped", m7Repeat: "same" }),
      session({ participant: "P02", f9: "read-not-tapped", m7Repeat: "different" }),
      session({ participant: "P03", f9: "tapped-unread" }),
    ]);

    expect(report.f9).toEqual({
      "read-not-tapped": 2,
      "tapped-unread": 1,
      "typed-instead": 0,
    });
    expect(report.m7).toEqual({ same: 1, different: 1 });
  });

  it("세션이 하나도 없으면 전부 빈 채로 돌려준다 — 0을 지어내지 않는다", () => {
    const report = buildReport([]);

    expect(report.participants).toBe(0);
    expect(report.tasks.every((task) => task.minui.medianMs === null)).toBe(true);
    expect(report.order.firstMedianMs).toBeNull();
  });
});
