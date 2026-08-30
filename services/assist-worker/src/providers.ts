/**
 * 중계기가 모델을 부르는 자리 — **한도 두 개를 잇는다** (AI-1, AI-2).
 *
 * <p>`services/enricher/src/llm.ts`와 같은 생각이되 여기서 다시 쓴다. 그쪽은
 * `node:fs`를 읽는 모듈들과 한 덩어리라 Worker 런타임에서 못 돈다 — 원래 worker.ts가
 * Gemini 호출을 따로 갖고 있던 것과 같은 이유다. <b>프롬프트와 스키마는 공유하고
 * 전송만 각자 한다.</b> 프롬프트가 갈라지면 여기서 나오는 답이 벤치한 것과 달라진다.
 *
 * <p>순서가 정책이다. Gemini가 먼저이고, 그것이 한도(429)나 장애(5xx)를 내면 두 번째
 * 공급자가 받는다. <b>둘 다 안 되면 `null`</b>이고, 그때 화면은 되묻기로 내려간다 —
 * 새 실패 모양을 만들지 않는 이유는 호출부가 이미 `null`을 다룰 줄 알기 때문이다.
 *
 * <p><b>두 번째 자리는 벤더를 고르지 않는다.</b> `/chat/completions`를 받는 곳이면
 * 무엇이든 붙는다 — 주소·키·모델 셋을 주면 그곳이 두 번째가 된다. 기본 주소를 두지
 * 않는 것이 의도다: 기본값이 있으면 키만 넣은 사람이 자기도 모르게 그 벤더로 요청을
 * 보낸다. 셋 중 하나라도 없으면 그 공급자를 아예 만들지 않는다.
 *
 * <p>키는 Cloudflare 시크릿에만 있다. 오류 본문에 섞여 나가지 않게 응답에서 지운다
 * (절대 보호선 규칙 7).
 */

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

export interface ProviderEnv {
  GOOGLE_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** 두 번째 공급자. **셋이 다 있어야 쓴다.** 벤더를 고르지 않는다 (기본 주소 없음). */
  OPENAI_COMPAT_API_KEY?: string;
  OPENAI_COMPAT_BASE_URL?: string;
  OPENAI_COMPAT_MODEL?: string;
}

export interface ModelAnswer {
  /** 파싱된 JSON. 모델이 답하지 못했으면 `null`. */
  value: unknown;
  /** 어느 모델이 답했는가. 화면의 출처 배지가 쓴다 (AI-8). */
  model: string | null;
}

/**
 * 한 번 묻는다. **앞의 것이 막히면 다음 것으로.**
 *
 * @returns 답과 <b>누가 답했는지</b>. 아무도 못 답하면 `{ value: null, model: null }`.
 */
export async function askModel(
  env: ProviderEnv,
  system: string,
  user: string,
  schema: unknown,
): Promise<ModelAnswer> {
  const attempts: { model: string; run: () => Promise<unknown> }[] = [];

  if (env.GOOGLE_API_KEY) {
    const model = env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
    attempts.push({
      model,
      run: () => askGemini(env.GOOGLE_API_KEY!, model, system, user, schema),
    });
  }
  // 셋이 다 있을 때만. 반쯤 설정된 상태로 보내면 어디로 갔는지 모르는 실패가 난다.
  if (env.OPENAI_COMPAT_API_KEY && env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_MODEL) {
    const model = env.OPENAI_COMPAT_MODEL;
    const baseUrl = env.OPENAI_COMPAT_BASE_URL;
    attempts.push({
      model,
      run: () =>
        askOpenAiCompatible(env.OPENAI_COMPAT_API_KEY!, baseUrl, model, system, user, schema),
    });
  }

  for (const attempt of attempts) {
    try {
      return { value: await attempt.run(), model: attempt.model };
    } catch (error) {
      // 왜 넘어갔는지는 로그에만. 본문에는 키가 섞여 있을 수 있어 이미 가려서 던진다.
      console.error(
        `[${attempt.model}]`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { value: null, model: null };
}

async function askGemini(
  key: string,
  model: string,
  system: string,
  user: string,
  schema: unknown,
): Promise<unknown> {
  const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.4,
      },
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).replace(key, "<키>");
    throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return parseOrNull(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
}

/**
 * OpenAI 호환 경로. **스키마를 강제하지 못한다.**
 *
 * <p>JSON 모드는 "JSON이기만 하면 된다"까지만 보장하므로 모양은 프롬프트로 부탁한다.
 * 어긋나도 화면에 닿지 않는다 — 돌려받은 것은 전부 파싱 검증을 지난다.
 */
async function askOpenAiCompatible(
  key: string,
  baseUrl: string,
  model: string,
  system: string,
  user: string,
  schema: unknown,
): Promise<unknown> {
  // 끝의 `/`를 떼어 둔다. 넣은 사람마다 다르게 쓰는데 `//chat/…`은 404가 난다.
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `${system}\n\n반드시 이 JSON 스키마에 맞는 JSON 하나만 답하세요. 설명을 덧붙이지 마세요.\n${JSON.stringify(schema)}`,
        },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).replace(key, "<키>");
    throw new Error(`${model} ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseOrNull(payload.choices?.[0]?.message?.content ?? "");
}

/**
 * JSON이 아니면 `null`. **고쳐 쓰려고 하지 않는다.**
 *
 * <p>반쯤 고친 JSON은 모델이 뜻한 것과 다를 수 있고, 그 값이 검증을 통과해 화면에
 * 닿으면 그것이 더 나쁘다.
 */
function parseOrNull(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
