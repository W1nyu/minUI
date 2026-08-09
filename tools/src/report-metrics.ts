import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * §12.1 지표 리포트.
 *
 * <p>두 산출물을 모아 하나의 표로 만든다.
 * <ul>
 *   <li>{@code task-metrics.json} — 과제 수행 (frontend의 시나리오 테스트가 만든다)
 *   <li>{@code personalization.json} — 개인화 시뮬레이션
 * </ul>
 *
 * <p>이 스크립트가 하지 않는 것이 하는 것만큼 중요하다. <b>재지 못한 지표를 빈칸으로 남긴다.</b>
 * 완료 시간·완료율·오탐색률은 사람이 있어야 나오는 수치이고, 스크립트가 만든 숫자를
 * 그 자리에 넣으면 표 전체가 거짓이 된다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "../out");

interface TaskRun {
  taskId: string;
  mode: "minui" | "classic";
  taps: number;
  offTarget: number;
  completed: boolean;
}

interface Personalization {
  persona: string;
  config: string;
  cardHitRate: number;
  visitHitRate: number;
  swapsPerWeek: number;
  settledOnDay: number | null;
  finalCards: string[];
}

function load<T>(name: string): T[] | null {
  const path = join(OUT_DIR, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T[];
}

const tasks = load<TaskRun>("task-metrics.json");
const personalization = load<Personalization>("personalization.json");

if (!tasks || !personalization) {
  console.error(
    "산출물이 없습니다. 먼저 아래를 실행하세요.\n" +
      "  pnpm vitest run --project frontend test/scenarios\n" +
      "  pnpm --filter tools simulate",
  );
  process.exit(1);
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

console.log("\n═══ §12.1 1차 지표 ═══\n");

console.log("탭 횟수 (목표: 기본 UI 대비 50% 감소)\n");
console.log(`  ${"과제".padEnd(20)}${"쉬운 모드".padStart(10)}${"기본 UI".padStart(10)}${"차이".padStart(10)}`);

const grouped = new Map<string, Partial<Record<"minui" | "classic", TaskRun>>>();
for (const run of tasks) {
  const key = run.taskId.replace(/ \(.*\)$/, "");
  const entry = grouped.get(run.taskId) ?? grouped.get(key) ?? {};
  entry[run.mode] = run;
  grouped.set(run.taskId, entry);
}

// S3은 경로가 셋이라 따로 다룬다.
const s3 = tasks.filter((r) => r.taskId.startsWith("S3"));
const simple = tasks.filter((r) => !r.taskId.startsWith("S3"));

const byTask = new Map<string, Partial<Record<"minui" | "classic", TaskRun>>>();
for (const run of simple) {
  const entry = byTask.get(run.taskId) ?? {};
  entry[run.mode] = run;
  byTask.set(run.taskId, entry);
}

for (const [taskId, pair] of byTask) {
  const a = pair.minui?.taps;
  const b = pair.classic?.taps;
  const diff =
    a === undefined || b === undefined
      ? "—"
      : b === 0
        ? a === 0
          ? "동률"
          : "+∞"
        : `${(((a - b) / b) * 100).toFixed(0)}%`;
  console.log(
    `  ${taskId.padEnd(20)}${String(a ?? "—").padStart(10)}${String(b ?? "—").padStart(10)}${diff.padStart(10)}`,
  );
}

if (s3.length > 0) {
  console.log("\n  S3 자동이체 관리 — 경로별");
  for (const run of s3) {
    console.log(`  ${run.taskId.padEnd(20)}${String(run.taps).padStart(10)}`);
  }
}

console.log("\n  완료율 · 완료 시간 · 오탐색률 — 측정 안 함 (사람이 있어야 나온다)");

console.log("\n═══ §12.1 2차 지표 ═══\n");
console.log("카드 적중률 (목표 70% 이상) · 주당 카드 교체 (목표 1회 이하)\n");
console.log(
  `  ${"페르소나 · 설정".padEnd(42)}${"적중률".padStart(9)}${"주당 교체".padStart(10)}${"수렴".padStart(8)}`,
);

for (const row of personalization) {
  const persona = row.persona.split(" · ")[0]!;
  const label = `${persona} · ${row.config}`;
  console.log(
    `  ${label.padEnd(42)}${pct(row.cardHitRate).padStart(9)}` +
      `${row.swapsPerWeek.toFixed(2).padStart(10)}` +
      `${(row.settledOnDay === null ? "변화없음" : `${row.settledOnDay}일`).padStart(8)}`,
  );
}

console.log("\n  음성 1회 성공률 — pnpm --filter tools bench:search 참고 (M4에서 측정)\n");
