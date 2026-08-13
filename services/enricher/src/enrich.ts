import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RiskLevel } from "@minui/core";
import { cleanLabel, isMenuLabel } from "../../../tools/src/labels.js";
import { guessRisk } from "../../../tools/src/risk.js";
import { Gemini, type Usage } from "./gemini.js";
import {
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
  combineRisk,
  parseResponse,
  type Enrichment,
  type MenuFacts,
} from "./prompt.js";

/**
 * 수집 원본 + LLM → `*.ai.json`.
 *
 * <p>사람이 쓴 `*.overrides.json`을 <b>건드리지 않는다.</b> 산출물을 따로 두고 빌더가
 * `raw < ai < 사람` 순으로 합친다. 사람 손이 언제나 이긴다 — 자동 생성물이 사람의 판단을
 * 덮으면, 다음에 사람이 무엇을 고쳤는지 알 수 없게 된다.
 *
 * <p><b>끊겨도 이어서 한다.</b> 무료 한도로 도는 이상 중간에 멈추는 것이 정상이고,
 * 그때마다 처음부터 다시 하면 한도를 두 배로 쓴다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGS = join(HERE, "../../../tools/catalogs");

export interface AiOverride {
  synonyms?: string[];
  riskLevel?: RiskLevel;
  cardable?: boolean;
  hint?: string;
}

interface RawFile {
  source: { site: string; host: string };
  items: { path: string[]; label: string; key: string }[];
}

export interface EnrichOptions {
  site: string;
  model: string;
  apiKey: string;
  /** 한 요청에 담을 메뉴 수. 크면 요청 수가 줄지만 실패했을 때 잃는 것도 커진다. */
  batchSize?: number;
  /** 시험 삼아 앞의 몇 개만. 한도를 태우기 전에 결과를 눈으로 보려고. */
  limit?: number;
  onProgress?: (message: string) => void;
}

export interface EnrichResult {
  site: string;
  model: string;
  total: number;
  enriched: number;
  rejected: number;
  usage: Usage;
  outPath: string;
}

/** 수집 원본에서 보강 대상 메뉴를 뽑는다. 빌더와 같은 규칙으로 거른다. */
export function menusFrom(raw: RawFile, site: string): MenuFacts[] {
  const seen = new Set<string>();
  const out: MenuFacts[] = [];

  for (const item of raw.items) {
    if (!isMenuLabel(item.label)) continue;
    const path = item.path.map(cleanLabel).filter(Boolean);
    if (path.some((part) => !isMenuLabel(part))) continue;

    const label = cleanLabel(item.label);
    const id = idOf(site, item.key, path, label);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, path });
  }
  return out;
}

/** `build-catalog.ts`의 `toId`와 같은 규칙. 여기서 어긋나면 보강이 아무 데도 안 붙는다. */
function idOf(site: string, key: string, path: string[], label: string): string {
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");
  if (kind === "page" || kind === "linkcd" || kind === "code") return `${site}.${value}`;
  if (kind === "path" && value && value !== "/" && !/void|null/.test(value)) {
    return `${site}.${slugify(value)}`;
  }
  return `${site}.${slugify([...path, label].join("-"))}`;
}

function slugify(value: string): string {
  return value
    .replace(/[^\w가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function enrich(options: EnrichOptions): Promise<EnrichResult> {
  const report = options.onProgress ?? (() => {});
  const batchSize = options.batchSize ?? 40;

  const raw = JSON.parse(
    readFileSync(join(CATALOGS, `${options.site}.raw.json`), "utf8"),
  ) as RawFile;

  const all = menusFrom(raw, options.site);
  const menus = options.limit ? all.slice(0, options.limit) : all;

  const outPath = join(CATALOGS, `${options.site}.ai.json`);
  const existing = loadExisting(outPath);

  // 이미 해 둔 것은 건너뛴다. 무료 한도로 도는 이상 이어하기가 기본 동작이어야 한다.
  const todo = menus.filter((menu) => !existing[menu.id]);
  report(
    `메뉴 ${menus.length}개 · 이미 된 것 ${menus.length - todo.length}개 · ` +
      `할 것 ${todo.length}개 (묶음 ${Math.ceil(todo.length / batchSize)}개)`,
  );

  const gemini = new Gemini(options.apiKey, {
    model: options.model,
    onNote: (message) => report(`  ${message}`),
  });

  let rejected = 0;
  const result: Record<string, AiOverride> = { ...existing };

  for (let start = 0; start < todo.length; start += batchSize) {
    const batch = todo.slice(start, start + batchSize);
    const answer = await gemini.json(SYSTEM_PROMPT, buildUserPrompt(batch), RESPONSE_SCHEMA);
    const parsed = parseResponse(answer, batch);
    rejected += parsed.rejected.length;

    for (const [index, enrichment] of parsed.accepted) {
      const menu = batch[index];
      if (!menu) continue;
      result[menu.id] = toOverride(menu, enrichment);
    }

    // 묶음마다 저장한다. 여기서 멈춰도 다음에 이어서 한다.
    save(outPath, options, result);

    const done = Math.min(start + batchSize, todo.length);
    report(
      `  ${done}/${todo.length}  받은 것 ${parsed.accepted.size} · 버린 것 ${parsed.rejected.length}` +
        `  (간격 ${Math.round(gemini.spacingMs)}ms)`,
    );
  }

  return {
    site: options.site,
    model: options.model,
    total: menus.length,
    enriched: Object.keys(result).filter((key) => !key.startsWith("_")).length,
    rejected,
    usage: gemini.usage,
    outPath,
  };
}

/**
 * 모델 답을 override 한 줄로. **위험도는 여기서 합친다.**
 *
 * <p>정규식과 모델 중 <b>더 위험한 쪽</b>을 택한다. 모델이 `high`를 `low`로 낮추면
 * 음성으로 이체가 실행되는 경로가 열린다(기획안 §9.3). 그것은 재 볼 성질의 문제가 아니다.
 */
function toOverride(menu: MenuFacts, enrichment: Enrichment): AiOverride {
  const byRule: RiskLevel = guessRisk(menu.label, menu.path);

  const override: AiOverride = {
    riskLevel: combineRisk(byRule, enrichment.riskLevel),
  };
  if (enrichment.synonyms.length > 0) override.synonyms = enrichment.synonyms;
  if (!enrichment.cardable) override.cardable = false;
  if (enrichment.hint.length > 0) override.hint = enrichment.hint;
  return override;
}

function loadExisting(path: string): Record<string, AiOverride> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const out: Record<string, AiOverride> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("_")) continue;
      out[key] = value as AiOverride;
    }
    return out;
  } catch {
    return {};
  }
}

function save(path: string, options: EnrichOptions, result: Record<string, AiOverride>): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = {
    _note:
      `${options.model}이 라벨과 경로만 보고 만든 것이다. 사람이 쓴 *.overrides.json이 ` +
      "언제나 우선한다(빌더 병합 순서 raw < ai < 사람). 직접 고치지 말고 다시 생성하라 — " +
      "고쳐야 할 판단이라면 overrides에 적는 것이 맞다. riskLevel은 정규식 판정과 " +
      "모델 판정 중 더 위험한 쪽이다.",
    ...result,
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}
