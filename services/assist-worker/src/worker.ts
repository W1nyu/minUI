import {
  ASSIST_SCHEMA,
  ASSIST_SYSTEM,
  buildAssistPrompt,
  parseAssistResponse,
} from "../../enricher/src/assist.js";
import {
  AnswerCache,
  cacheKey,
  checkAssistRequest,
  clientKey,
  DailyBudget,
  MAX_BODY_BYTES,
  RateLimiter,
} from "./guard.js";

/**
 * `/api/assist` 중계기 — **없어도 되는 부품.**
 *
 * <p>배포는 GitHub Pages(정적)라 서버가 없다. 뜻풀이와 Studio는 미리 구워서 해결했지만
 * 도우미는 임의의 발화를 받아야 해서 못 굽는다. 그래서 이것 하나만 따로 띄운다.
 *
 * <p><b>시연 대본은 이것에 기대지 않는다.</b> 엔드포인트가 설정돼 있지 않으면 화면은
 * `assist`를 아예 안 넘기고(`demos/src/App.tsx`), 검색은 로컬 → 되묻기로 끝난다.
 * 살아 있으면 되묻기 화면이 후보로 덮이고, 죽어 있으면 되묻기가 그대로 답이 된다.
 * 둘 다 설계된 화면이라 <b>무엇이 빠졌는지 보이지 않는다.</b> 그것이 이 부품을
 * 이렇게 둔 이유다 — 기획안 §14가 "시연 중 429로 기능 사망"을 리스크로 적어 뒀다.
 *
 * <p>키는 Cloudflare 시크릿에만 있다. 이 파일에도 번들에도 없고, 오류 본문에 섞여
 * 나가지 않게 응답에서 지운다 (절대 보호선 규칙 7).
 *
 * <p>고르는 일 자체는 `services/enricher/src/assist.ts`를 그대로 쓴다. 프롬프트가
 * 갈라지면 여기서 나오는 답이 벤치마크한 것과 달라진다.
 */

export interface Env {
  GOOGLE_API_KEY: string;
  /** 요청을 받아 줄 곳. 쉼표로 여럿. 없으면 아무 데서나 받지 않는다. */
  ALLOWED_ORIGINS?: string;
  GEMINI_MODEL?: string;
  DAILY_BUDGET?: string;
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";

/*
 * 격리 공간마다 하나씩 생긴다. 완벽한 전역 계수가 아니라는 것을 알고 쓴다 —
 * `guard.ts`의 RateLimiter 주석에 왜 이 정도로 충분한지 적어 뒀다.
 */
const cache = new AnswerCache();
const limiter = new RateLimiter();
let budget: DailyBudget | null = null;

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
        model: env.GEMINI_MODEL ?? DEFAULT_MODEL,
        cached: cache.size,
        budgetLeft: budget.left,
      });
    }

    if (request.method !== "POST") return json(405, { menuId: null });

    // 오리진을 안 알아보면 받지 않는다. 남의 사이트가 우리 한도를 태우게 두지 않는다.
    if (!cors["access-control-allow-origin"]) {
      return json(403, { menuId: null });
    }

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

    // ② 형식과 상한
    const checked = checkAssistRequest(parsed);
    if (!checked.ok) return json(400, { menuId: null, why: checked.reason });
    if (checked.value.candidates.length === 0) return json(200, { menuId: null, why: "후보 없음" });

    // ③ 캐시 — 여기서 답하면 한도를 안 쓴다. 부정 응답도 담는다.
    const key = cacheKey(checked.value);
    const hit = cache.get(key);
    if (hit) return json(200, { menuId: hit.menuId, why: "cached" });

    // ④ 호출 제한 — 캐시 미스만 센다.
    const blocked = limiter.check(clientKey(request.headers));
    if (blocked) return json(200, { menuId: null, why: blocked });

    // ⑤ 하루 예산
    budget ??= new DailyBudget(Number(env.DAILY_BUDGET ?? 800));
    if (!budget.take()) return json(200, { menuId: null, why: "오늘 예산을 다 썼습니다." });

    if (!env.GOOGLE_API_KEY) return json(200, { menuId: null, why: "키 없음" });

    try {
      const answer = await ask(env, checked.value.query, checked.value.candidates);
      cache.set(key, answer.menuId);
      return json(200, answer);
    } catch (error) {
      /*
       * 죽어도 200에 `menuId: null`로 답한다. 화면에는 되묻기가 이미 떠 있고,
       * 여기서 상태를 하나 더 만들면 `AllMenuSheet`·`VoiceSearchSheet`의 계약이
       * 셋으로 늘어난다. 왜 꺼졌는지는 로그에만 남긴다.
       */
      console.error("[assist]", error instanceof Error ? error.message : String(error));
      return json(200, { menuId: null, why: "도우미 없음" });
    }
  },
};

async function ask(
  env: Env,
  query: string,
  candidates: Parameters<typeof buildAssistPrompt>[1],
): Promise<{ menuId: string | null; why: string }> {
  const model = env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: ASSIST_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: buildAssistPrompt(query, candidates) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: ASSIST_SCHEMA,
        temperature: 0.4,
      },
    }),
  });

  if (!response.ok) {
    // 본문에 키가 섞여 돌아오는 경우가 있어 그대로 던지지 않는다 (`gemini.ts`와 같은 이유).
    const body = (await response.text()).replace(env.GOOGLE_API_KEY, "<키>");
    throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (raw.length === 0) return { menuId: null, why: "빈 응답" };

  try {
    return parseAssistResponse(JSON.parse(raw), candidates);
  } catch {
    return { menuId: null, why: "응답이 JSON이 아님" };
  }
}
