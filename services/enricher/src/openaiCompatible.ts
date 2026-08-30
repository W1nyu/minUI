import { describeSchema, type LlmClient } from "./llm.js";

/**
 * OpenAI 호환 엔드포인트 호출 — **두 번째 공급자 자리** (AI-1).
 *
 * <p>Gemini와 같은 일을 하되 다른 회사의 한도를 쓴다. 그것이 전부다. 품질 때문에
 * 데려온 것이 아니라 <b>한 곳이 막혔을 때 시연이 멈추지 않게</b> 하려고 데려왔다.
 *
 * <p><b>벤더를 고르지 않는다.</b> `/chat/completions`를 받는 곳이면 무엇이든 붙는다 —
 * 주소와 모델 이름만 주면 된다. 처음에는 한 벤더 이름을 파일과 환경변수에 박아 뒀다가
 * 고쳤다: AGENTS.md가 "선택 기준은 유행이 아니라 한국어 성능, 지연, 비용, 개인정보
 * 처리, 재현 가능한 벤치 결과"라고 적어 뒀는데, 이름을 코드에 박으면 그 기준으로
 * 고를 수가 없다. 국내 벤더로 옮길 때도 이 성질이 값을 한다.
 *
 * <pre>
 *   OPENAI_COMPAT_BASE_URL   https://api.example.com/v1   ← 필수. 기본값을 두지 않는다
 *   OPENAI_COMPAT_API_KEY    sk-…                          ← 필수
 *   OPENAI_COMPAT_MODEL      some-model                    ← 필수
 * </pre>
 *
 * <p><b>기본 주소를 두지 않는 것이 의도다.</b> 기본값을 두면 그 벤더를 고른 것이 되고,
 * 키만 넣은 사람이 자기도 모르게 그쪽으로 요청을 보낸다. 셋 중 하나라도 없으면 이
 * 공급자를 아예 만들지 않는다 — 그때는 Gemini 하나로 돌고, 그것으로 충분하다.
 *
 * <p>키 취급은 `gemini.ts`와 같다 — 환경변수에서만 읽고, 오류 본문에서 키를 가리고,
 * 이 모듈 밖으로 키가 나가는 경로를 만들지 않는다 (절대 보호선 규칙 7).
 *
 * <p><b>스키마를 강제하지 못한다.</b> JSON 모드는 "JSON이기만 하면 된다"까지만 보장하므로
 * 모양은 프롬프트로 부탁한다(`describeSchema`). 돌려받은 것은 어차피 `validateProposal`을
 * 지나므로, 여기서 모양이 어긋나도 화면에 닿지 않는다.
 */

export interface OpenAiCompatibleOptions {
  /** `/chat/completions`를 붙일 뿌리. 예: `https://api.example.com/v1` */
  baseUrl: string;
  model: string;
  /** 요청 사이 최소 간격(ms). 429가 나면 스스로 늘린다 — `gemini.ts`와 같은 방식. */
  spacingMs?: number;
  onNote?: (message: string) => void;
}

/** 환경변수에서 읽은 설정. 셋 중 하나라도 없으면 `null`. */
export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 두 번째 공급자를 쓸 수 있는가.
 *
 * <p>**셋이 다 있어야 한다.** 하나라도 비면 `null`이고, 호출자는 이 공급자를 안 만든다.
 * 반쯤 설정된 상태로 요청을 보내면 어디로 갔는지 모르는 실패가 난다.
 */
export function readOpenAiCompatibleConfig(): OpenAiCompatibleConfig | null {
  const apiKey = process.env["OPENAI_COMPAT_API_KEY"]?.trim();
  const baseUrl = process.env["OPENAI_COMPAT_BASE_URL"]?.trim();
  const model = process.env["OPENAI_COMPAT_MODEL"]?.trim();

  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl, model };
}

export class OpenAiCompatible implements LlmClient {
  readonly name: string;

  readonly #key: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #note: (message: string) => void;
  #spacing: number;
  #lastCallAt = 0;

  constructor(key: string, options: OpenAiCompatibleOptions) {
    this.#key = key;
    this.#model = options.model;
    // 끝의 `/`를 떼어 둔다. 넣은 사람마다 다르게 쓰는데 `//chat/…`은 404가 난다.
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#spacing = options.spacingMs ?? 1_000;
    this.#note = options.onNote ?? (() => {});
    this.name = options.model;
  }

  async json(system: string, user: string, schema: unknown): Promise<unknown> {
    const body = {
      model: this.#model,
      messages: [
        { role: "system", content: system + describeSchema(schema) },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      // `gemini.ts`와 같은 값. 두 공급자의 답이 온도 때문에 갈리면 비교가 무의미해진다.
      temperature: 0.4,
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await this.#pace();

      const response = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#key}`,
        },
        body: JSON.stringify(body),
      });

      if (response.status === 429 || response.status >= 500) {
        // 한도에 걸렸으면 앞으로도 걸린다. 이번만 기다리지 말고 간격 자체를 늘린다.
        this.#spacing = Math.min(this.#spacing * 1.6, 30_000);
        const wait = Math.min(1_500 * 2 ** attempt, 30_000);
        this.#note(`한도(${response.status}) — ${Math.round(wait / 1000)}초 쉽니다`);
        await sleep(wait);
        continue;
      }

      if (!response.ok) {
        const text = (await response.text()).replace(this.#key, "<키>");
        throw new Error(`${this.#model} ${response.status}: ${text.slice(0, 300)}`);
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = payload.choices?.[0]?.message?.content ?? "";
      if (text.length === 0) return null;

      try {
        return JSON.parse(text);
      } catch {
        /*
         * JSON 모드인데도 어긋나는 일이 있다. 여기서 고쳐 보려 애쓰지 않는다 —
         * 반쯤 고친 JSON은 모델이 뜻한 것과 다를 수 있고, 그 값이 검증을 통과해
         * 화면에 닿으면 그것이 더 나쁘다. 모른다고 답한다.
         */
        this.#note("응답이 JSON이 아닙니다 — 이 요청은 건너뜁니다");
        return null;
      }
    }

    throw new Error(`${this.#model} 한도에 계속 걸립니다.`);
  }

  async #pace(): Promise<void> {
    const since = Date.now() - this.#lastCallAt;
    if (since < this.#spacing) await sleep(this.#spacing - since);
    this.#lastCallAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
