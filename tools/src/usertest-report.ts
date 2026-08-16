import type { AgeBand, F9Outcome, Mode, Session, TaskRun } from "./usertest-session.js";

/**
 * M10 1차 지표 집계 (기획안 §12.1 · §12.9 · §12.10).
 *
 * <p>파일 시스템을 모른다. 계산에 입출력이 붙으면 규칙을 테스트할 수 없고, 규칙을
 * 테스트할 수 없으면 "중단한 과제를 뺐는가" 같은 것을 사람이 눈으로 확인하게 된다.
 * `report-metrics.ts`가 셋을 한 파일에 둔 탓에 테스트가 없다 — 같은 실수를 되풀이하지 않는다.
 *
 * <p>여기서 하지 않는 것: <b>유의성 판정.</b> 표본 8명에 검정력이 없다. p값을 계산하는
 * 순간 이 표를 읽는 사람이 그것을 근거로 쓴다.
 */

/** 1차 지표에 드는 과제. `T2-repeat`(학습 효과)와 `F9`(시간이 아니라 세 갈래)는 빠진다. */
export const PRIMARY_TASKS = ["T1", "T2", "T3"] as const;

const F9_OUTCOMES = ["read-not-tapped", "tapped-unread", "typed-instead"] as const;

export interface ModeStat {
  /** 완료한 수행만. 표본이 없으면 null — 0이 아니다. */
  medianMs: number | null;
  /** 중앙값의 원자료, 오름차순. 8명에서 평균은 한 명이 흔든다 — 독자가 직접 본다. */
  samplesMs: number[];
  completed: number;
  attempted: number;
  /** 개입 1·2를 받고 완료한 수. 그 시간에는 진행자의 힌트가 실려 있다. */
  assisted: number;
  /** 개입 3 — 진행자가 중단시킨 수. */
  aborted: number;
  offTargetPerRun: number | null;
}

export interface TaskStat {
  taskId: string;
  minui: ModeStat;
  classic: ModeStat;
}

export interface OrderEffect {
  /** 참가자가 **먼저** 한 모드의 완료 시간 중앙값. */
  firstMedianMs: number | null;
  /** **나중에** 한 모드의 중앙값. 둘이 크게 갈리면 counterbalancing이 상쇄하지 못한 것이다. */
  secondMedianMs: number | null;
}

export interface Report {
  participants: number;
  byAgeBand: Record<AgeBand, number>;
  tasks: TaskStat[];
  completion: Record<Mode, { completed: number; attempted: number }>;
  order: OrderEffect;
  f9: Record<F9Outcome, number>;
  m7: { same: number; different: number };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

interface Pair {
  session: Session;
  run: TaskRun;
}

/** 진행자가 그 수행에 개입한 단계. 기록이 없으면 0. */
function interventionOf({ session, run }: Pair): number {
  return session.interventions[`${run.taskId}:${run.mode}`] ?? 0;
}

function statOf(pairs: Pair[]): ModeStat {
  const samplesMs = pairs
    .filter(({ run }) => run.completed && run.elapsedMs !== null)
    .map(({ run }) => run.elapsedMs!)
    .sort((a, b) => a - b);

  const offTargets = pairs.map(({ run }) => run.offTarget);

  return {
    medianMs: median(samplesMs),
    samplesMs,
    completed: pairs.filter(({ run }) => run.completed).length,
    attempted: pairs.length,
    assisted: pairs.filter((pair) => pair.run.completed && interventionOf(pair) > 0).length,
    aborted: pairs.filter((pair) => interventionOf(pair) >= 3).length,
    offTargetPerRun:
      offTargets.length === 0
        ? null
        : offTargets.reduce((sum, value) => sum + value, 0) / offTargets.length,
  };
}

export function buildReport(sessions: Session[]): Report {
  const primary = new Set<string>(PRIMARY_TASKS);

  const pairs: Pair[] = sessions.flatMap((session) =>
    session.runs.filter((run) => primary.has(run.taskId)).map((run) => ({ session, run })),
  );

  const tasks: TaskStat[] = PRIMARY_TASKS.map((taskId) => ({
    taskId,
    minui: statOf(pairs.filter((p) => p.run.taskId === taskId && p.run.mode === "minui")),
    classic: statOf(pairs.filter((p) => p.run.taskId === taskId && p.run.mode === "classic")),
  }));

  const completion: Record<Mode, { completed: number; attempted: number }> = {
    minui: { completed: 0, attempted: 0 },
    classic: { completed: 0, attempted: 0 },
  };
  for (const { run } of pairs) {
    completion[run.mode].attempted += 1;
    if (run.completed) completion[run.mode].completed += 1;
  }

  const done = pairs.filter(({ run }) => run.completed && run.elapsedMs !== null);
  const order: OrderEffect = {
    firstMedianMs: median(
      done
        .filter(({ session, run }) => run.mode === session.firstMode)
        .map(({ run }) => run.elapsedMs!),
    ),
    secondMedianMs: median(
      done
        .filter(({ session, run }) => run.mode !== session.firstMode)
        .map(({ run }) => run.elapsedMs!),
    ),
  };

  const byAgeBand: Record<AgeBand, number> = { "60+": 0, "40-50": 0 };
  for (const session of sessions) byAgeBand[session.ageBand] += 1;

  const f9 = Object.fromEntries(F9_OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    F9Outcome,
    number
  >;
  for (const session of sessions) if (session.f9) f9[session.f9] += 1;

  const m7 = { same: 0, different: 0 };
  for (const session of sessions) if (session.m7Repeat) m7[session.m7Repeat] += 1;

  return { participants: sessions.length, byAgeBand, tasks, completion, order, f9, m7 };
}
