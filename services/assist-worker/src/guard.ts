import type { AssistCandidate } from "../../enricher/src/assist.js";

/**
 * 도우미 중계기 앞에 세우는 문들.
 *
 * <p>이 파일에 네트워크가 없는 것이 요점이다. 입력 상한·캐시 키·토큰 버킷은 전부
 * 순수 함수라 <b>Worker를 띄우지 않고 잰다.</b> 이 저장소가 onnx와 Gemini를 다룰 때
 * 쓴 것과 같은 규율이다 — 바깥과 말하는 부분은 얇게 남기고 판단은 밖으로 뺀다.
 *
 * <p>기획안 §14가 "공개 API 남용 | 시연 중 429로 기능 사망 | 호출 제한·입력 상한·캐시 |
 * <b>M13, 미구현</b>"이라고 적어 둔 자리다. 여기서 그것을 구현한다.
 */

// ── 입력 상한 ────────────────────────────────────────────────────────────
//
// 429보다 싼 문이다. 한도를 태우기 전에 막는다.

/** 구어 한 문장. `LearnedTerms`의 `maxTermChars`(20)보다 넉넉하되 토큰을 묶는다. */
export const MAX_QUERY_CHARS = 120;
/** `shared/host-ai/assist.ts`의 `CANDIDATE_COUNT`와 같다. 서버에서도 강제한다. */
export const MAX_CANDIDATES = 20;
export const MAX_LABEL_CHARS = 60;
export const MAX_HINT_CHARS = 120;
export const MAX_PATH_DEPTH = 6;
/** 본문 전체. 넘으면 읽지 않고 끊는다. */
export const MAX_BODY_BYTES = 32 * 1024;

export interface AssistRequest {
  query: string;
  candidates: AssistCandidate[];
}

export type Checked = { ok: true; value: AssistRequest } | { ok: false; reason: string };

/**
 * 들어온 본문이 쓸 만한가. **자르지 않고 거른다.**
 *
 * <p>넘치는 것을 잘라서 받으면 사용자가 보낸 것과 모델이 본 것이 달라진다.
 * 우리 클라이언트는 이미 상한 안에서 보내므로, 넘친다는 것은 우리 클라이언트가 아니라는 뜻이다.
 */
export function checkAssistRequest(body: unknown): Checked {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "본문이 없습니다." };
  const raw = body as Record<string, unknown>;

  const query = raw["query"];
  if (typeof query !== "string" || query.trim().length === 0) {
    return { ok: false, reason: "질의가 없습니다." };
  }
  if (query.length > MAX_QUERY_CHARS) {
    return { ok: false, reason: `질의는 ${MAX_QUERY_CHARS}자까지입니다.` };
  }

  const candidates = raw["candidates"];
  if (!Array.isArray(candidates)) return { ok: false, reason: "후보가 없습니다." };
  if (candidates.length > MAX_CANDIDATES) {
    return { ok: false, reason: `후보는 ${MAX_CANDIDATES}개까지입니다.` };
  }

  const checked: AssistCandidate[] = [];
  for (const item of candidates) {
    if (typeof item !== "object" || item === null) return { ok: false, reason: "후보 형식이 틀렸습니다." };
    const candidate = item as Record<string, unknown>;

    const menuId = candidate["menuId"];
    const label = candidate["label"];
    if (typeof menuId !== "string" || menuId.length === 0) {
      return { ok: false, reason: "후보에 menuId가 없습니다." };
    }
    if (typeof label !== "string" || label.length === 0 || label.length > MAX_LABEL_CHARS) {
      return { ok: false, reason: "후보 이름이 비었거나 너무 깁니다." };
    }

    const path = candidate["path"];
    if (path !== undefined) {
      if (!Array.isArray(path) || path.length > MAX_PATH_DEPTH) {
        return { ok: false, reason: "후보 경로가 너무 깊습니다." };
      }
      if (path.some((part) => typeof part !== "string")) {
        return { ok: false, reason: "후보 경로 형식이 틀렸습니다." };
      }
    }

    const hint = candidate["hint"];
    if (hint !== undefined && (typeof hint !== "string" || hint.length > MAX_HINT_CHARS)) {
      return { ok: false, reason: "후보 뜻풀이가 너무 깁니다." };
    }

    checked.push({
      menuId,
      label,
      ...(path ? { path: path as string[] } : {}),
      ...(hint ? { hint: hint as string } : {}),
    });
  }

  return { ok: true, value: { query, candidates: checked } };
}

// ── 캐시 ─────────────────────────────────────────────────────────────────

/**
 * 캐시 키. **질의와 후보 집합이 같으면 답도 같다.**
 *
 * <p>후보를 키에 넣는 이유: 같은 말이라도 사이트가 다르면 후보가 달라지고 답도 달라진다.
 * 정렬해서 넣는 것은 엔진이 순서를 조금 바꿔도 같은 답을 재활용하기 위해서다 —
 * 모델은 번호로 고르지만 우리는 그 번호를 다시 id로 바꿔 돌려주므로 순서가 달라도 안전하다.
 */
export function cacheKey(request: AssistRequest): string {
  const query = request.query.trim().toLowerCase().replace(/\s+/g, " ");
  const ids = request.candidates
    .map((candidate) => candidate.menuId)
    .slice()
    .sort()
    .join(",");
  return `${query}|${ids}`;
}

export interface CacheEntry {
  menuId: string | null;
  at: number;
}

/**
 * 아주 작은 LRU. **답이 `null`인 것도 담는다.**
 *
 * <p>부정 응답을 안 담으면 "날씨 어때" 같은 말이 반복될 때마다 한도를 태운다.
 * 실제로 이 경로에 오는 질의의 상당수가 답이 없는 것들이다 — `-1`을 낼 수 있게
 * 만들어 둔 이유와 같다(`services/enricher/src/assist.ts`).
 */
export class AnswerCache {
  readonly #map = new Map<string, CacheEntry>();
  readonly #max: number;
  readonly #ttlMs: number;

  constructor(max = 1_000, ttlMs = 24 * 60 * 60 * 1_000) {
    this.#max = max;
    this.#ttlMs = ttlMs;
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: string, now = Date.now()): CacheEntry | undefined {
    const found = this.#map.get(key);
    if (!found) return undefined;
    if (now - found.at > this.#ttlMs) {
      this.#map.delete(key);
      return undefined;
    }
    // 최근 것으로 올린다.
    this.#map.delete(key);
    this.#map.set(key, found);
    return found;
  }

  set(key: string, menuId: string | null, now = Date.now()): void {
    this.#map.delete(key);
    this.#map.set(key, { menuId, at: now });
    while (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next();
      if (oldest.done) break;
      this.#map.delete(oldest.value);
    }
  }
}

// ── 호출 제한 ────────────────────────────────────────────────────────────

export interface BucketLimits {
  perMinute: number;
  perHour: number;
}

export const DEFAULT_LIMITS: BucketLimits = { perMinute: 20, perHour: 200 };

/**
 * IP 하나당 토큰 버킷 둘. **캐시가 답한 요청은 세지 않는다** — 호출자가 정한다.
 *
 * <p>Worker는 요청마다 같은 격리 공간에 들어가지 않으므로 이 계수는 완벽하지 않다.
 * 그래도 둔다: 완벽한 제한이 목적이 아니라 <b>한 사람이 실수로 또는 장난으로 한도를
 * 다 태우는 것</b>을 막는 것이 목적이고, 그건 이걸로 충분히 막힌다. 완벽하게 하려면
 * Durable Object가 필요한데 그것은 이 데모가 질 무게가 아니다.
 */
export class RateLimiter {
  readonly #minute = new Map<string, number[]>();
  readonly #hour = new Map<string, number[]>();
  readonly #limits: BucketLimits;

  constructor(limits: BucketLimits = DEFAULT_LIMITS) {
    this.#limits = limits;
  }

  /** @returns 통과하면 `null`, 막히면 이유. */
  check(client: string, now = Date.now()): string | null {
    const minute = prune(this.#minute, client, now, 60_000);
    if (minute.length >= this.#limits.perMinute) return "잠시 뒤에 다시 시도해 주세요.";

    const hour = prune(this.#hour, client, now, 3_600_000);
    if (hour.length >= this.#limits.perHour) return "오늘은 여기까지입니다.";

    minute.push(now);
    hour.push(now);
    return null;
  }
}

function prune(store: Map<string, number[]>, client: string, now: number, window: number): number[] {
  const kept = (store.get(client) ?? []).filter((at) => now - at < window);
  store.set(client, kept);
  return kept;
}

/**
 * 하루 예산. **캐시 미스만 센다.**
 *
 * <p>무료 등급을 다 태우면 429가 나고, 그때는 기능이 죽는 게 아니라 되묻기로 내려간다.
 * 그래도 예산을 따로 두는 이유는 <b>언제 왜 멈췄는지 알기 위해서</b>다 — 429는 밖에서
 * 오는 신호라 우리가 모르는 사이에 시작되고 끝난다.
 */
export class DailyBudget {
  #day = "";
  #used = 0;
  readonly #limit: number;

  constructor(limit = 800) {
    this.#limit = limit;
  }

  get used(): number {
    return this.#used;
  }

  get left(): number {
    return Math.max(0, this.#limit - this.#used);
  }

  /** @returns 쓸 수 있으면 참. 참을 돌려준 순간 한 칸을 쓴 것으로 친다. */
  take(now = new Date()): boolean {
    const today = now.toISOString().slice(0, 10);
    if (today !== this.#day) {
      this.#day = today;
      this.#used = 0;
    }
    if (this.#used >= this.#limit) return false;
    this.#used += 1;
    return true;
  }
}

/** 요청을 보낸 쪽을 무엇으로 셀 것인가. Cloudflare가 넣어 주는 것을 먼저 본다. */
export function clientKey(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
