import {
  ASSIST_SCHEMA,
  ASSIST_SYSTEM,
  buildAssistPrompt,
  parseAssistResponse,
} from "../../enricher/src/assist.js";
import {
  CLARIFY_SCHEMA,
  CLARIFY_SYSTEM,
  buildClarifyPrompt,
  parseClarifyResponse,
} from "../../enricher/src/clarify.js";
import {
  CONFIRM_SCHEMA,
  CONFIRM_SYSTEM,
  buildConfirmPrompt,
  parseConfirmResponse,
} from "../../enricher/src/confirm.js";
import {
  CORRECT_SCHEMA,
  CORRECT_SYSTEM,
  buildCorrectPrompt,
  parseCorrectResponse,
} from "../../enricher/src/correct.js";
import {
  EXPLAIN_SCHEMA,
  EXPLAIN_SYSTEM,
  buildExplainPrompt,
  parseExplainResponse,
} from "../../enricher/src/explain.js";
import {
  SAFETY_SCHEMA,
  SAFETY_SYSTEM,
  buildSafetyPrompt,
  parseSafetyResponse,
} from "../../enricher/src/safetyTips.js";
import { isSafeAssistQuery, isSafeMenuLabel } from "../../../shared/host-ai/privacy.js";
import {
  AnswerCache,
  cacheKey,
  checkAssistRequest,
  checkClarifyRequest,
  checkConfirmRequest,
  checkCorrectRequest,
  checkExplainRequest,
  checkSafetyRequest,
  clientKey,
  DailyBudget,
  MAX_BODY_BYTES,
  RateLimiter,
} from "./guard.js";
import { askModel, DEFAULT_GEMINI_MODEL, type ProviderEnv } from "./providers.js";

/**
 * AI 중계기 — **여섯을 중계한다** (AI-2·AI-5·AI-6).
 *
 * <p>배포는 GitHub Pages(정적)라 서버가 없다. 뜻풀이 대부분과 Studio는 미리 구워서
 * 해결했지만, 임의의 발화를 받아야 하는 것들은 못 굽는다. 그래서 이것 하나만 따로 띄운다.
 *
 * <pre>
 *   /assist    후보 중 하나 고르기        없으면 되묻기가 그대로 답
 *   /explain   캐시에 없는 말을 그 자리에서  없으면 구워 둔 451개까지만
 *   /clarify   한 문장 되묻기 + 두 갈래     없으면 지금의 갈래 되묻기
 *   /confirm   확인 문장의 뼈대            없으면 앱의 고정 문구
 *   /safety    점검마다 지금 할 일 한 줄    없으면 걸린 것만 보인다
 *   /correct   잘못 들린 말을 고쳐 쓴다     없으면 들린 그대로 찾는다
 * </pre>
 *
 * <p><b>여섯 다 없어도 된다.</b> 엔드포인트가 설정돼 있지 않으면 화면은 그 capability를
 * 아예 안 넘기고, 프로덕션 번들에서 호출 경로가 사라진다. 살아 있으면 화면이 조금 더
 * 친절해지고, 죽어 있으면 지금까지의 화면이 그대로 답이 된다 — <b>둘 다 설계된
 * 화면이라 무엇이 빠졌는지 보이지 않는다.</b>
 *
 * <p><b>여섯이 같은 문을 지난다.</b> 크기 → 개인정보 → 형식 → 캐시 → 호출 제한 → 하루 예산.
 * 경로마다 따로 세우면 한 곳이 빠지고, 빠진 그 한 곳이 열린 문이 된다. 특히
 * 개인정보 문은 전에 `/assist`만 지나고 있었다 (`shared/host-ai/privacy.ts`).
 *
 * <p>키는 Cloudflare 시크릿에만 있다. 이 파일에도 번들에도 없고, 오류 본문에 섞여
 * 나가지 않게 지운다 (절대 보호선 규칙 7).
 */

export interface Env extends ProviderEnv {
  GOOGLE_API_KEY: string;
  /** 두 번째 무료 한도. **없어도 된다** — 있으면 Gemini가 막혔을 때 받는다. */
  DEEPSEEK_API_KEY?: string;
  /** 요청을 받아 줄 곳. 쉼표로 여럿. 없으면 아무 데서나 받지 않는다. */
  ALLOWED_ORIGINS?: string;
  GEMINI_MODEL?: string;
  DEEPSEEK_MODEL?: string;
  DAILY_BUDGET?: string;
}

/*
 * 격리 공간마다 하나씩 생긴다. 완벽한 전역 계수가 아니라는 것을 알고 쓴다 —
 * `guard.ts`의 RateLimiter 주석에 왜 이 정도로 충분한지 적어 뒀다.
 */
const cache = new AnswerCache();
const limiter = new RateLimiter();
let budget: DailyBudget | null = null;

/** 경로 이름. `/`는 `/assist`다 — 기존 배포의 `ASSIST_URL`이 루트를 가리킨다. */
type Route = "assist" | "explain" | "clarify" | "confirm" | "safety" | "correct";

const ROUTES: readonly Route[] = [
  "assist",
  "explain",
  "clarify",
  "confirm",
  "safety",
  "correct",
];

function routeOf(pathname: string): Route | null {
  const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  if (last === "") return "assist";
  return (ROUTES as readonly string[]).includes(last) ? (last as Route) : null;
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ok = origin !== null && allowed.includes(origin);
  return {
    ...(ok ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin, env);

    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...cors },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    /*
     * 상태 점검. 심사 직전에 이 주소 하나로 살아 있는지 본다.
     * **키 재료는 절대 나가지 않는다** — 있는지 없는지만 말한다.
     */
    if (request.method === "GET") {
      budget ??= new DailyBudget(Number(env.DAILY_BUDGET ?? 800));
      return json(200, {
        gemini: env.GOOGLE_API_KEY ? "ready" : "off",
        deepseek: env.DEEPSEEK_API_KEY ? "ready" : "off",
        model: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
        routes: ROUTES,
        cached: cache.size,
        budgetLeft: budget.left,
      });
    }

    if (request.method !== "POST") return json(405, { menuId: null });

    const route = routeOf(new URL(request.url).pathname);
    if (!route) return json(404, { menuId: null });

    // 오리진을 안 알아보면 받지 않는다. 남의 사이트가 우리 한도를 태우게 두지 않는다.
    if (!cors["access-control-allow-origin"]) return json(403, { menuId: null });

    // ① 크기 — 읽기 전에 막는다. 가장 싼 문이다.
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json(413, { menuId: null });

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { menuId: null });

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json(400, { menuId: null });
    }

    /*
     * ② 형식과 상한, 그리고 **개인정보 문.**
     *
     * 무엇을 물어볼지와 캐시 키를 여기서 함께 정한다. 경로마다 다른 것은 이 한 곳뿐이고,
     * 뒤의 문 넷(캐시·제한·예산·호출)은 전부 공유한다.
     */
    const prepared = prepare(route, parsed);
    if (!prepared.ok) return json(prepared.status, prepared.body);

    // ③ 캐시 — 여기서 답하면 한도를 안 쓴다. 부정 응답도 담는다.
    const hit = cache.get(`${route}:${prepared.key}`);
    if (hit) return json(200, { ...prepared.fromCache(hit.menuId), why: "cached" });

    // ④ 호출 제한 — 캐시 미스만 센다.
    const blocked = limiter.check(clientKey(request.headers));
    if (blocked) return json(200, prepared.empty(blocked));

    // ⑤ 하루 예산
    budget ??= new DailyBudget(Number(env.DAILY_BUDGET ?? 800));
    if (!budget.take()) return json(200, prepared.empty("오늘 예산을 다 썼습니다."));

    if (!env.GOOGLE_API_KEY && !env.DEEPSEEK_API_KEY) {
      return json(200, prepared.empty("키 없음"));
    }

    /*
     * ⑥ 물어본다. 죽어도 200에 빈 답으로 돌려준다 — 화면에는 이미 다음 선택지가 떠
     * 있고, 여기서 상태를 하나 더 만들면 화면의 계약이 셋으로 늘어난다.
     */
    const answer = await askModel(env, prepared.system, prepared.user, prepared.schema);
    const body = prepared.parse(answer.value, answer.model);
    if (typeof body.cacheAs === "string" || body.cacheAs === null) {
      cache.set(`${route}:${prepared.key}`, body.cacheAs);
    }
    return json(200, body.payload);
  },
};

/** 경로별로 갈라지는 것만 모은다. 뒤의 문 넷은 이 결과를 공통으로 쓴다. */
interface Prepared {
  ok: true;
  key: string;
  system: string;
  user: string;
  schema: unknown;
  /** 캐시가 답할 때의 본문. 문자열 하나로 답하는 경로(`/assist`·`/explain`·`/correct`)만 캐시에 담을 값이 있다. */
  fromCache: (menuId: string | null) => Record<string, unknown>;
  /** 못 물어봤을 때의 본문. 경로마다 화면이 기대하는 빈 모양이 다르다. */
  empty: (why: string) => Record<string, unknown>;
  parse: (
    raw: unknown,
    model: string | null,
  ) => { payload: Record<string, unknown>; cacheAs?: string | null };
}

type PrepareResult = Prepared | { ok: false; status: number; body: Record<string, unknown> };

function prepare(route: Route, parsed: unknown): PrepareResult {
  if (route === "assist") {
    const checked = checkAssistRequest(parsed);
    if (!checked.ok) return { ok: false, status: 400, body: { menuId: null, why: checked.reason } };
    const { query, candidates } = checked.value;
    if (candidates.length === 0) {
      return { ok: false, status: 200, body: { menuId: null, why: "후보 없음" } };
    }
    /*
     * **개인정보 문.** 전에는 브라우저에서만 걸렀다. 브라우저를 안 거치는 요청 앞에서
     * 그 검사는 없는 것과 같다 — 서버가 같은 판정을 한 번 더 본다.
     */
    if (!isSafeAssistQuery(query)) {
      return { ok: false, status: 200, body: { menuId: null, why: "이 말은 기기 안에서 찾습니다." } };
    }

    return {
      ok: true,
      key: cacheKey(checked.value),
      system: ASSIST_SYSTEM,
      user: buildAssistPrompt(query, candidates),
      schema: ASSIST_SCHEMA,
      fromCache: (menuId) => ({ menuId }),
      empty: (why) => ({ menuId: null, why }),
      parse: (raw) => {
        const answer = parseAssistResponse(raw, candidates);
        return { payload: { ...answer }, cacheAs: answer.menuId };
      },
    };
  }

  if (route === "explain") {
    const checked = checkExplainRequest(parsed);
    if (!checked.ok) return { ok: false, status: 400, body: { hint: null, why: checked.reason } };
    const target = checked.value;
    /*
     * 카탈로그는 **남의 사이트에서 긁어온 것**이다. 수집기가 로그인 뒤 화면을 잘못 읽어
     * 사람 이름이 든 라벨을 만들 수 있고, 그것이 그대로 모델로 나가면 안 된다.
     */
    if (!isSafeMenuLabel(target.label)) {
      return { ok: false, status: 200, body: { hint: null, why: "보내지 않는 이름입니다." } };
    }

    return {
      ok: true,
      key: `${target.label}|${(target.path ?? []).join(">")}`,
      system: EXPLAIN_SYSTEM,
      user: buildExplainPrompt(target),
      schema: EXPLAIN_SCHEMA,
      fromCache: (hint) => ({ hint }),
      empty: (why) => ({ hint: null, why }),
      parse: (raw, model) => {
        const hint = parseExplainResponse(raw, target);
        return { payload: { hint, model }, cacheAs: hint };
      },
    };
  }

  if (route === "clarify") {
    const checked = checkClarifyRequest(parsed);
    if (!checked.ok) {
      return { ok: false, status: 400, body: { clarification: null, why: checked.reason } };
    }
    const { query, branches } = checked.value;
    if (!isSafeAssistQuery(query)) {
      return {
        ok: false,
        status: 200,
        body: { clarification: null, why: "이 말은 기기 안에서 찾습니다." },
      };
    }

    return {
      ok: true,
      key: `${query}|${branches.map((branch) => branch.label).join(",")}`,
      system: CLARIFY_SYSTEM,
      user: buildClarifyPrompt(query, branches),
      schema: CLARIFY_SCHEMA,
      // 되묻기는 문장이 통째로 필요해 캐시에 못 담는다. 캐시는 id 하나만 담는 그릇이다.
      fromCache: () => ({ clarification: null }),
      empty: (why) => ({ clarification: null, why }),
      parse: (raw, model) => ({
        payload: { clarification: parseClarifyResponse(raw, branches), model },
      }),
    };
  }

  if (route === "confirm") {
    const checked = checkConfirmRequest(parsed);
    if (!checked.ok) {
      return { ok: false, status: 400, body: { template: null, why: checked.reason } };
    }
    const context = checked.value;

    return {
      ok: true,
      key: `${context.riskLevel}|${context.concerns.slice().sort().join(",")}`,
      system: CONFIRM_SYSTEM,
      user: buildConfirmPrompt(context),
      schema: CONFIRM_SCHEMA,
      fromCache: () => ({ template: null }),
      empty: (why) => ({ template: null, why }),
      parse: (raw, model) => ({ payload: { template: parseConfirmResponse(raw), model } }),
    };
  }

  if (route === "safety") {
    const checked = checkSafetyRequest(parsed);
    if (!checked.ok) {
      return { ok: false, status: 400, body: { tips: [], why: checked.reason } };
    }
    const { kinds } = checked.value;

    return {
      ok: true,
      /*
       * **종류 이름만으로 답이 정해진다.** 값이 안 실리므로 같은 조합이면 같은 답이고,
       * `SafetyKind`가 여섯이라 조합이 유한하다 — 며칠이면 사실상 전부 캐시된다.
       */
      key: kinds.slice().sort().join(","),
      system: SAFETY_SYSTEM,
      user: buildSafetyPrompt(kinds),
      schema: SAFETY_SCHEMA,
      // 여러 줄이라 id 하나짜리 캐시 그릇에 안 들어간다. 응답 캐시는 안 쓴다.
      fromCache: () => ({ tips: [] }),
      empty: (why) => ({ tips: [], why }),
      parse: (raw, model) => ({ payload: { tips: parseSafetyResponse(raw, kinds), model } }),
    };
  }

  const checked = checkCorrectRequest(parsed);
  if (!checked.ok) {
    return { ok: false, status: 400, body: { corrected: null, why: checked.reason } };
  }
  const { heard, candidates } = checked.value;
  /*
   * 들린 말도 사용자 발화다. `/assist`와 **같은 문**을 지난다 — 숫자·송금·계좌·수취인이
   * 든 발화는 기기 안에서 끝난다.
   */
  if (!isSafeAssistQuery(heard)) {
    return { ok: false, status: 200, body: { corrected: null, why: "이 말은 기기 안에서 찾습니다." } };
  }

  return {
    ok: true,
    key: heard,
    system: CORRECT_SYSTEM,
    user: buildCorrectPrompt(heard, candidates),
    schema: CORRECT_SCHEMA,
    fromCache: (corrected) => ({ corrected }),
    empty: (why) => ({ corrected: null, why }),
    parse: (raw, model) => {
      const corrected = parseCorrectResponse(raw, heard);
      return { payload: { corrected, model }, cacheAs: corrected };
    },
  };
}
