import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  FEATURE_NAMES,
  MenuIndex,
  NgramTfIdfProvider,
  SearchPipeline,
  extractFeatures,
  pronounce,
  normalize,
  type FeatureName,
  type Features,
  type MenuCatalog,
  type MinUIConfig,
} from "@minui/core";
import { catalogFor, isAnswer, isRecognized, loadCorpus } from "./corpus.js";

/**
 * 재순위 학습·판정이 나눠 쓰는 데이터 (M23).
 *
 * <p>`fit:rerank`와 `bench:rerank`가 <b>같은 특징, 같은 분할</b>을 봐야 한다.
 * 두 벌로 두면 적합한 가중치와 잰 가중치가 다른 것을 설명하게 된다.
 *
 * <h3>홀드아웃을 두 축으로 건다</h3>
 *
 * <p>하나만으로는 부족하다. 사이트로만 나누면 "이 화자에게만 되는 것"이 걸러지지 않고,
 * 화자로만 나누면 "이 사이트의 동의어에 맞춘 것"이 걸러지지 않는다.
 *
 * <ul>
 *   <li><b>사이트</b> — 신한·KB증권·하나는 실패를 보고 동의어를 고친 곳이다.
 *       KB국민·미래에셋은 손대지 않았다 (`tune-search.ts`가 정한 분할).
 *   <li><b>화자</b> — A1은 본인, B1은 다른 사람 (`음성코퍼스-프로토콜.md`).
 * </ul>
 *
 * <p>미니은행(`bank`)은 <b>학습에만</b> 쓴다. 내가 엔진에 맞춰 메뉴 25개를 고른 곳이라
 * 판정 근거가 될 수 없다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

export const TUNE_SITES = ["shinhan", "kbsec", "kebhana"] as const;
export const HOLDOUT_SITES = ["kbstar", "miraeasset"] as const;
export const HOLDOUT_SPEAKER = "B1";

/** 학습 후보를 몇 개까지 볼 것인가. 문턱 위만 재정렬하므로 넉넉히 잡아도 해롭지 않다. */
const CANDIDATE_LIMIT = 8;

/** 채점 한 줄 — 하나의 질의와 그 후보들. */
export interface Sample {
  site: string;
  query: string;
  expect: string;
  /** 후보. `rank()` 순서 그대로 — 0번이 지금의 1위다. */
  candidates: { menuId: string; features: Features; correct: boolean; score: number }[];
}

export interface Split {
  train: Sample[];
  holdout: Sample[];
  /** 답이 없어야 할 질의. 사이트마다 걸어 본다. */
  negatives: string[];
}

interface SiteQueries {
  sites: Record<string, { query: string; expect: string }[]>;
  negative: string[];
}

const pipelines = new Map<string, SearchPipeline>();

export function pipelineFor(site: string, config: MinUIConfig = DEFAULT_CONFIG): SearchPipeline | null {
  const key = `${site}|${config === DEFAULT_CONFIG ? "default" : "custom"}`;
  const cached = pipelines.get(key);
  if (cached) return cached;
  const catalog = catalogFor(site);
  if (!catalog) return null;
  const index = new MenuIndex(catalog);
  const pipeline = new SearchPipeline(index, config, NgramTfIdfProvider.build(index.documents()));
  pipelines.set(key, pipeline);
  return pipeline;
}

const indexes = new Map<string, MenuIndex>();

function indexFor(site: string): MenuIndex | null {
  const cached = indexes.get(site);
  if (cached) return cached;
  const catalog = catalogFor(site);
  if (!catalog) return null;
  const index = new MenuIndex(catalog);
  indexes.set(site, index);
  return index;
}

/** 질의 하나를 후보와 특징으로 펼친다. 정답이 후보 안에 없으면 `null`이다. */
export function toSample(site: string, query: string, expect: string): Sample | null {
  const pipeline = pipelineFor(site);
  const index = indexFor(site);
  if (!pipeline || !index) return null;

  const ranked = pipeline.rank(query, CANDIDATE_LIMIT);
  if (ranked.length < 2) return null;
  if (!ranked.some((c) => isAnswer(site, c.menuId, expect))) return null;

  const normalized = normalize(query);
  const context = {
    normalized,
    sound: DEFAULT_CONFIG.search.phonology.enabled ? pronounce(normalized) : "",
    topScore: ranked[0]!.score,
    confusion: DEFAULT_CONFIG.search.confusion,
  };

  const byId = new Map(index.menus.map((menu) => [menu.menuId, menu]));
  const candidates = ranked.flatMap((candidate) => {
    const menu = byId.get(candidate.menuId);
    if (!menu) return [];
    return [
      {
        menuId: candidate.menuId,
        features: extractFeatures(candidate, menu, context),
        correct: isAnswer(site, candidate.menuId, expect),
        score: candidate.score,
      },
    ];
  });

  return { site, query, expect, candidates };
}

/**
 * 학습 세트와 홀드아웃을 만든다.
 *
 * <p><b>정답이 후보 안에 없는 질의는 뺀다.</b> 재순위가 손댈 수 없는 줄이라 학습에
 * 넣으면 "무엇을 해도 틀린" 예시로 가중치를 흔든다. 그 줄들이 몇 개인지는 헤드룸 분석이
 * 이미 세었다(구제 불가 10건).
 */
export function buildSplit(): Split {
  const train: Sample[] = [];
  const holdout: Sample[] = [];

  // ① 텍스트 세트 — 사이트로 가른다
  const siteQueries = JSON.parse(
    readFileSync(join(HERE, "../fixtures/site-queries.json"), "utf8"),
  ) as SiteQueries;

  for (const [site, cases] of Object.entries(siteQueries.sites)) {
    const bucket = (HOLDOUT_SITES as readonly string[]).includes(site) ? holdout : train;
    for (const testCase of cases) {
      const sample = toSample(site, testCase.query, testCase.expect);
      if (sample) bucket.push(sample);
    }
  }

  // ② 미니은행 구어체 세트 — 학습에만
  const voice = JSON.parse(
    readFileSync(join(HERE, "../fixtures/voice-queries.json"), "utf8"),
  ) as { cases: { query: string; expect: string }[] };
  for (const testCase of voice.cases) {
    const sample = toSample("bank", testCase.query, testCase.expect);
    if (sample) train.push(sample);
  }

  // ③ 음성 코퍼스 — 사이트와 화자 **둘 다** 홀드아웃이어야 홀드아웃이다
  const corpus = loadCorpus();
  for (const row of corpus?.rows ?? []) {
    if (!isRecognized(row) || row.expect === undefined) continue;
    const sample = toSample(row.site, row.heard, row.expect);
    if (!sample) continue;
    const heldSite = (HOLDOUT_SITES as readonly string[]).includes(row.site);
    const heldSpeaker = row.speaker === HOLDOUT_SPEAKER;
    (heldSite && heldSpeaker ? holdout : train).push(sample);
  }

  return { train, holdout, negatives: siteQueries.negative };
}

/** 특징 이름 순서를 고정한 벡터. 학습기가 쓴다. */
export function toVector(features: Features): number[] {
  return FEATURE_NAMES.map((name) => features[name]);
}

export function toWeights(vector: readonly number[]): Partial<Record<FeatureName, number>> {
  const weights: Partial<Record<FeatureName, number>> = {};
  FEATURE_NAMES.forEach((name, i) => {
    weights[name] = Number((vector[i] ?? 0).toFixed(4));
  });
  return weights;
}

export type { MenuCatalog };
