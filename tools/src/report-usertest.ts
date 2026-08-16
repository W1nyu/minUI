import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, type ModeStat, type Report } from "./usertest-report.js";
import { parseSession, type Session } from "./usertest-session.js";

/**
 * M10 사용자 테스트 리포트 (기획안 §12.9 · §12.10).
 *
 * <p>`report-metrics.ts`가 "사람이 있어야 나온다"며 비워 둔 세 칸 — 완료 시간·완료율·
 * 오탐색률 — 을 채우는 짝이다. <b>세션 파일이 없으면 그 칸을 그대로 비워 둔다.</b>
 * 목표를 맞추려고 기준을 옮기지 않는 것과 같은 규칙이다.
 *
 * <p>진행자는 세션마다 `copy(minuiMetrics.toJSON())`으로 회수한 것을 봉투에 넣어
 * `tools/sessions/P01.json`으로 저장한다. 형식은 `tools/sessions/EXAMPLE.json`,
 * 진행 절차는 `docs/사용자테스트-키트.md`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(HERE, "../sessions");

/** 형식 예시는 집계에 넣지 않는다 — 넣으면 없는 참가자가 표에 선다. */
const EXAMPLE = "EXAMPLE.json";

/** 표에 과제 번호만 보이면 무엇이었는지 기억해야 한다. 이름을 붙여 둔다. */
const TASK_LABELS: Record<string, string> = {
  T1: "T1 잔액 (자주 쓰는 것)",
  T2: "T2 자동이체 (찾아야 하는 것)",
  T3: "T3 이체 한도 (이름을 모르는 것)",
};

function loadSessions(): Session[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((name) => name.endsWith(".json") && name !== EXAMPLE)
    .sort()
    .map((name) =>
      parseSession(JSON.parse(readFileSync(join(SESSIONS_DIR, name), "utf8")), name),
    );
}

/**
 * 한글은 터미널에서 두 칸을 먹는다.
 *
 * <p>`padEnd`는 코드 단위로 세므로 한글이 섞인 열은 반드시 어긋난다. 표가 어긋나면
 * 읽는 사람이 어느 숫자가 어느 열인지 세게 되고, 그때부터 표가 아니라 퍼즐이다.
 */
function width(text: string): number {
  let total = 0;
  for (const character of text) {
    total +=
      /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(
        character,
      )
        ? 2
        : 1;
  }
  return total;
}

const padEndW = (text: string, size: number) => text + " ".repeat(Math.max(0, size - width(text)));
const padStartW = (text: string, size: number) =>
  " ".repeat(Math.max(0, size - width(text))) + text;

/** 이름 열과 숫자 열들의 너비. 헤더와 본문이 같은 값을 쓴다. */
const LABEL = 34;
const COLUMN = 11;

const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(0)}s`);

const sampleList = (samplesMs: number[]) =>
  samplesMs.length === 0 ? "—" : `[${samplesMs.map((ms) => (ms / 1000).toFixed(0)).join(",")}]`;

function diff(a: number | null, b: number | null): string {
  if (a === null || b === null) return "—";
  if (b === 0) return a === 0 ? "동률" : "+∞";
  return `${(((a - b) / b) * 100).toFixed(0)}%`;
}

/** 시간에 실린 사연. 개입을 받은 수행을 숨기면 그 시간이 순수한 것처럼 보인다. */
function note(label: string, stat: ModeStat): string {
  const parts: string[] = [];
  if (stat.assisted > 0) parts.push(`개입 후 완료 ${stat.assisted}`);
  if (stat.aborted > 0) parts.push(`중단 ${stat.aborted}`);
  return parts.length === 0 ? "" : `  ${label}: ${parts.join(" · ")}`;
}

function print(report: Report): void {
  console.log(
    `\n═══ M10 1차 지표 — 참가자 ${report.participants}명 ` +
      `(60+ ${report.byAgeBand["60+"]}, 40-50 ${report.byAgeBand["40-50"]}) ═══\n`,
  );

  console.log(
    padEndW("완료 시간 (중앙값)", LABEL + 2) +
      padStartW("쉬운 모드", COLUMN) +
      padStartW("기본 UI", COLUMN) +
      padStartW("차이", COLUMN),
  );
  for (const task of report.tasks) {
    const label = TASK_LABELS[task.taskId] ?? task.taskId;
    console.log(
      `  ${padEndW(label, LABEL)}` +
        padStartW(seconds(task.minui.medianMs), COLUMN) +
        padStartW(seconds(task.classic.medianMs), COLUMN) +
        padStartW(diff(task.minui.medianMs, task.classic.medianMs), COLUMN),
    );
    console.log(
      `     ${sampleList(task.minui.samplesMs)}  ${sampleList(task.classic.samplesMs)}` +
        `${note("쉬운", task.minui)}${note("기본", task.classic)}`,
    );
  }

  const rate = (part: { completed: number; attempted: number }) =>
    part.attempted === 0
      ? "—"
      : `${part.completed}/${part.attempted} (${((part.completed / part.attempted) * 100).toFixed(0)}%)`;

  console.log(
    `\n  ${padEndW("완료율", LABEL)}` +
      padStartW(rate(report.completion.minui), COLUMN) +
      padStartW(rate(report.completion.classic), COLUMN),
  );

  const offAverage = (mode: "minui" | "classic") => {
    const values = report.tasks
      .map((task) => task[mode].offTargetPerRun)
      .filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
  };
  const off = (value: number | null) => (value === null ? "—" : value.toFixed(1));

  console.log(
    `  ${padEndW("오탐색률 (수행당)", LABEL)}` +
      padStartW(off(offAverage("minui")), COLUMN) +
      padStartW(off(offAverage("classic")), COLUMN),
  );

  /*
   * counterbalancing이 8명에서 상쇄된다는 보장이 없다. 상쇄가 안 됐으면 그 사실도
   * 결과의 일부다 — 표에서 지우지 않고 눈에 띄게 적는다.
   */
  const { firstMedianMs, secondMedianMs } = report.order;
  const skewed =
    firstMedianMs !== null && secondMedianMs !== null && secondMedianMs < firstMedianMs * 0.7;
  console.log(
    `\n순서 효과 — 먼저 한 모드 ${seconds(firstMedianMs)} / 나중 한 모드 ${seconds(secondMedianMs)}` +
      (skewed ? "  ⚠ 상쇄 안 됨 — 그대로 보고할 것" : ""),
  );

  console.log(
    `\nF9  읽고 안 누름 ${report.f9["read-not-tapped"]} · ` +
      `안 읽고 누름 ${report.f9["tapped-unread"]} · 직접 침 ${report.f9["typed-instead"]}`,
  );
  console.log(`M7  같은 말 ${report.m7.same} / 다른 말 ${report.m7.different}`);

  console.log(
    `\n표본 ${report.participants}명 — 유의성 주장 없음. 관찰된 패턴과 개별 사례로 읽을 것.\n`,
  );
}

const sessions = loadSessions();

if (sessions.length === 0) {
  console.log("\n═══ M10 1차 지표 ═══\n");
  console.log("  완료 시간 · 완료율 · 오탐색률 — 미측정 (사람이 있어야 나온다)\n");
  console.log(`  세션 기록을 ${SESSIONS_DIR}에 P01.json 형태로 두면 여기 채워집니다.`);
  console.log("  형식: tools/sessions/EXAMPLE.json · 진행 절차: docs/사용자테스트-키트.md\n");
} else {
  print(buildReport(sessions));
}
