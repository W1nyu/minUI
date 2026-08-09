import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DAY_MS,
  MemoryStorageAdapter,
  MinUIEngine,
  resolveConfig,
  type MenuId,
  type PartialConfig,
} from "@minui/core";
import { CATALOG, COLD_START_PRESETS } from "../../frontend/src/catalog.js";

/**
 * 개인화 시뮬레이션 — 기획안 §12.1의 2차 지표.
 *
 * <p>사용자 테스트 없이 잴 수 있는 두 가지를 잰다.
 * <ul>
 *   <li><b>카드 적중률</b> — 홈 카드만으로 목적을 달성한 세션 비율 (목표 70%)
 *   <li><b>배치 안정성</b> — 주당 카드 교체 횟수 (목표 1회 이하)
 * </ul>
 *
 * <p>이 둘은 사용 패턴만 주어지면 결정되는 엔진의 성질이라, 사람이 없어도 정확히 잴 수 있다.
 * 다만 <b>사용 패턴 자체는 내가 지어낸 것</b>이므로, 여기서 나온 적중률은 "이런 식으로 쓰는
 * 사람에게는 이렇게 된다"는 조건부 수치다. 실제 사용 로그가 생기면 그것으로 다시 재야 한다.
 *
 * <p>페르소나 두 명을 돌리는 이유가 있다. A는 온보딩 프리셋이 이미 잘 맞는 사람이고,
 * B는 프리셋이 전혀 안 맞는 사람이다. 개인화가 값을 하는지는 B에서 드러난다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../out/personalization.json");

const START = Date.UTC(2026, 0, 1, 0, 0, 0);
const DAYS = 120;

interface Persona {
  name: string;
  note: string;
  /** 그날 사용할 메뉴들. 빈 배열이면 앱을 열지 않는다. */
  schedule: (day: number, date: Date) => MenuId[];
  /** 들어갔다 그냥 나오는 메뉴 (완료 없음). */
  bounces?: (day: number, date: Date) => MenuId[];
}

const PERSONAS: Persona[] = [
  {
    name: "A · 김순자 (73세, 연금 수령자)",
    note: "온보딩 프리셋이 이미 맞는 경우. 개인화가 할 일이 거의 없다.",
    schedule: (_day, date) => {
      const menus: MenuId[] = [];
      const weekday = date.getUTCDay();
      const dayOfMonth = date.getUTCDate();

      if (weekday === 1 || weekday === 4) menus.push("inquiry.balance");
      if (dayOfMonth === 25) menus.push("transfer.account");
      if (dayOfMonth === 5 || dayOfMonth === 6) menus.push("inquiry.history");
      if (dayOfMonth === 15 && date.getUTCMonth() % 2 === 0) menus.push("support.call");
      return menus;
    },
  },
  {
    name: "B · 박현우 (46세, 저빈도 투자자)",
    note: "프리셋과 실제 사용이 어긋나는 경우. 개인화의 값어치는 여기서 드러난다.",
    schedule: (_day, date) => {
      const menus: MenuId[] = [];
      const dayOfMonth = date.getUTCDate();

      // 분기마다 몰아서 확인하고, 그 사이에는 거의 안 연다.
      if (dayOfMonth === 2 || dayOfMonth === 3) menus.push("product.fund");
      if (dayOfMonth === 2) menus.push("inquiry.accounts");
      if (dayOfMonth === 10) menus.push("product.savings");
      if (dayOfMonth === 20) menus.push("settings.limit");
      return menus;
    },
    bounces: (_day, date) =>
      // 가끔 잘못 들어갔다 나온다. 이런 방문이 카드로 올라오면 안 된다.
      date.getUTCDate() === 7 ? ["product.loan"] : [],
  },
];

interface Outcome {
  persona: string;
  config: string;
  sessions: number;
  /** 홈 카드만으로 목적을 달성한 세션 비율. */
  cardHitRate: number;
  /** 목표 메뉴가 카드에 있었던 사용 건 비율. */
  visitHitRate: number;
  swaps: number;
  swapsPerWeek: number;
  /** 카드 구성이 마지막으로 바뀐 날. 수렴 시점. */
  settledOnDay: number | null;
  finalCards: MenuId[];
}

async function simulate(
  persona: Persona,
  configName: string,
  config: PartialConfig | undefined,
): Promise<Outcome> {
  const storage = new MemoryStorageAdapter();

  let sessions = 0;
  let sessionsFullyCovered = 0;
  let visits = 0;
  let visitsOnCard = 0;
  let swaps = 0;
  let settledOnDay: number | null = null;
  let previous: MenuId[] = [];
  let finalCards: MenuId[] = [];

  for (let day = 0; day < DAYS; day++) {
    const dayStart = START + day * DAY_MS;
    const date = new Date(dayStart);
    const wanted = persona.schedule(day, date);
    const bounced = persona.bounces?.(day, date) ?? [];

    if (wanted.length === 0 && bounced.length === 0) continue;

    // 하루 = 한 세션. 엔진은 세션 시작에 한 번만 재배치를 결정한다.
    let clock = dayStart + 9 * 3600_000;
    const engine = await MinUIEngine.create({
      catalog: CATALOG,
      onAction: () => {},
      storage,
      coldStartPresets: COLD_START_PRESETS,
      now: () => clock,
      ...(config ? { config } : {}),
    });

    const cards = engine.getCards().map((card) => card.menuId);
    finalCards = cards;

    if (previous.length > 0) {
      const changed = cards.filter((id) => !previous.includes(id)).length;
      if (changed > 0) {
        swaps += changed;
        settledOnDay = day;
      }
    }
    previous = cards;

    if (wanted.length > 0) {
      sessions += 1;
      let allCovered = true;

      for (const menuId of wanted) {
        visits += 1;
        if (cards.includes(menuId)) visitsOnCard += 1;
        else allCovered = false;

        engine.open(menuId);
        engine.complete(menuId);
        clock += 90_000;
      }
      if (allCovered) sessionsFullyCovered += 1;
    }

    for (const menuId of bounced) {
      engine.open(menuId); // 완료하지 않는다
      clock += 20_000;
    }

    await engine.close();
  }

  const weeks = DAYS / 7;
  return {
    persona: persona.name,
    config: configName,
    sessions,
    cardHitRate: sessions === 0 ? 0 : sessionsFullyCovered / sessions,
    visitHitRate: visits === 0 ? 0 : visitsOnCard / visits,
    swaps,
    swapsPerWeek: swaps / weeks,
    settledOnDay,
    finalCards,
  };
}

// 기획안 §8.2가 "초기 가설이며 조정 대상"이라고 명시한 값들을 흔들어 본다.
const VARIANTS: { name: string; config?: PartialConfig }[] = [
  { name: "기본 (마진 20% · 1회 1장)" },
  {
    name: "마진 10%",
    config: { stability: { challengerMarginRatio: 1.1 } },
  },
  {
    name: "마진 50%",
    config: { stability: { challengerMarginRatio: 1.5 } },
  },
  {
    name: "1회 2장",
    config: { stability: { maxSwapsPerRecompute: 2 } },
  },
  {
    name: "쿨다운 12시간",
    config: { stability: { recomputeCooldownMs: DAY_MS / 2 } },
  },
];

const results: Outcome[] = [];

for (const persona of PERSONAS) {
  for (const variant of VARIANTS) {
    results.push(await simulate(persona, variant.name, variant.config));
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 2), "utf8");

// ── 출력 ────────────────────────────────────────────────────────────────

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

for (const persona of PERSONAS) {
  console.log(`\n${persona.name}`);
  console.log(`  ${persona.note}`);
  console.log(
    `\n  ${"설정".padEnd(24)}${"세션 적중".padStart(10)}${"사용 적중".padStart(10)}` +
      `${"주당 교체".padStart(10)}${"수렴".padStart(8)}`,
  );

  for (const row of results.filter((r) => r.persona === persona.name)) {
    console.log(
      `  ${row.config.padEnd(24)}${pct(row.cardHitRate).padStart(10)}` +
        `${pct(row.visitHitRate).padStart(10)}` +
        `${row.swapsPerWeek.toFixed(2).padStart(10)}` +
        `${(row.settledOnDay === null ? "—" : `${row.settledOnDay}일`).padStart(8)}`,
    );
  }

  const base = results.find(
    (r) => r.persona === persona.name && r.config.startsWith("기본"),
  )!;
  console.log(`\n  기본 설정의 최종 카드: ${base.finalCards.join(", ")}`);
}

console.log(
  `\n목표 (기획안 §12.1 2차 지표): 카드 적중률 70% 이상 · 주당 교체 1회 이하\n` +
    `산출: ${OUT}\n`,
);
