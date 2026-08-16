/**
 * 사용자 테스트 세션 봉투 (기획안 §12.10).
 *
 * <p>`TaskRun[]`에는 참가자도, 어느 모드를 먼저 했는지도, 진행자가 몇 번 개입했는지도
 * 없다. 그것들이 없으면 순서 효과를 못 보고 개입이 실린 수행을 못 가른다. 그래서 봉투를
 * 씌우고, 봉투는 진행자가 기록 양식에서 손으로 옮겨 적는다.
 *
 * <p><b>깨진 봉투에서 조용히 넘어가지 않는다.</b> 한 참가자가 표에서 빠져도 8명 중
 * 7명이라는 사실을 아무도 눈치채지 못한다. 파일 이름과 필드 이름을 달아 세게 실패한다.
 */

export type AgeBand = "60+" | "40-50";
export type Mode = "minui" | "classic";
export type F9Outcome = "read-not-tapped" | "tapped-unread" | "typed-instead";
export type M7Repeat = "same" | "different";

const AGE_BANDS: readonly string[] = ["60+", "40-50"];
const MODES: readonly string[] = ["minui", "classic"];
const F9_OUTCOMES: readonly string[] = ["read-not-tapped", "tapped-unread", "typed-instead"];
const M7_REPEATS: readonly string[] = ["same", "different"];

/** `frontend/src/instrumentation/TaskRecorder.tsx`의 `TaskRun`과 같은 형. */
export interface TaskRun {
  taskId: string;
  mode: Mode;
  targetMenuId: string;
  startedAt: number;
  endedAt: number | null;
  elapsedMs: number | null;
  taps: number;
  screens: string[];
  offTarget: number;
  completed: boolean;
}

export interface Session {
  participant: string;
  ageBand: AgeBand;
  firstMode: Mode;
  runs: TaskRun[];
  /** `"<taskId>:<mode>"` → 개입 단계. 3이면 진행자가 중단시킨 것이다. */
  interventions: Record<string, number>;
  /** 과제별로 참가자가 쓴 낱말. 발화 순서대로, 원문 그대로. */
  words: Record<string, string[]>;
  f9?: F9Outcome;
  m7Repeat?: M7Repeat;
}

function fail(source: string, field: string, detail: string): never {
  throw new Error(`${source}: ${field} — ${detail}`);
}

function asRecord(value: unknown, source: string, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(source, field, "객체여야 합니다.");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, source: string, field: string): string {
  if (typeof value !== "string" || value === "") {
    fail(source, field, "비어 있지 않은 문자열이어야 합니다.");
  }
  return value;
}

function asNumber(value: unknown, source: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(source, field, "숫자여야 합니다.");
  }
  return value;
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly string[],
  source: string,
  field: string,
): T {
  const text = asString(value, source, field);
  if (!allowed.includes(text)) {
    fail(source, field, `${allowed.join(" | ")} 중 하나여야 합니다. 받은 값: ${text}`);
  }
  return text as T;
}

function parseRun(raw: unknown, source: string, index: number): TaskRun {
  const field = `runs[${index}]`;
  const run = asRecord(raw, source, field);

  const screens = run.screens;
  if (!Array.isArray(screens)) fail(source, `${field}.screens`, "배열이어야 합니다.");

  return {
    taskId: asString(run.taskId, source, `${field}.taskId`),
    mode: asEnum<Mode>(run.mode, MODES, source, `${field}.mode`),
    targetMenuId: asString(run.targetMenuId, source, `${field}.targetMenuId`),
    startedAt: asNumber(run.startedAt, source, `${field}.startedAt`),
    endedAt: run.endedAt === null ? null : asNumber(run.endedAt, source, `${field}.endedAt`),
    elapsedMs:
      run.elapsedMs === null ? null : asNumber(run.elapsedMs, source, `${field}.elapsedMs`),
    taps: asNumber(run.taps, source, `${field}.taps`),
    screens: screens.map((screen, at) => asString(screen, source, `${field}.screens[${at}]`)),
    offTarget: asNumber(run.offTarget, source, `${field}.offTarget`),
    completed: run.completed === true,
  };
}

export function parseSession(raw: unknown, source: string): Session {
  const envelope = asRecord(raw, source, "세션");

  const runs = envelope.runs;
  if (!Array.isArray(runs)) {
    fail(source, "runs", "배열이어야 합니다. minuiMetrics.toJSON()의 결과를 그대로 넣으세요.");
  }

  const interventions: Record<string, number> = {};
  for (const [key, value] of Object.entries(
    envelope.interventions === undefined
      ? {}
      : asRecord(envelope.interventions, source, "interventions"),
  )) {
    interventions[key] = asNumber(value, source, `interventions.${key}`);
  }

  const words: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(
    envelope.words === undefined ? {} : asRecord(envelope.words, source, "words"),
  )) {
    if (!Array.isArray(value)) fail(source, `words.${key}`, "배열이어야 합니다.");
    words[key] = value.map((word, at) => asString(word, source, `words.${key}[${at}]`));
  }

  return {
    participant: asString(envelope.participant, source, "participant"),
    ageBand: asEnum<AgeBand>(envelope.ageBand, AGE_BANDS, source, "ageBand"),
    firstMode: asEnum<Mode>(envelope.firstMode, MODES, source, "firstMode"),
    runs: runs.map((run, index) => parseRun(run, source, index)),
    interventions,
    words,
    ...(envelope.f9 === undefined
      ? {}
      : { f9: asEnum<F9Outcome>(envelope.f9, F9_OUTCOMES, source, "f9") }),
    ...(envelope.m7Repeat === undefined
      ? {}
      : { m7Repeat: asEnum<M7Repeat>(envelope.m7Repeat, M7_REPEATS, source, "m7Repeat") }),
  };
}
