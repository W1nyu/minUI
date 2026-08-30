import { describeSchema, type LlmClient } from "./llm.js";

/**
 * DeepSeek 호출 — **두 번째 무료 한도** (AI-1).
 *
 * <p>Gemini와 같은 일을 하되 다른 회사의 한도를 쓴다. 그것이 전부다. 품질 때문에
 * 데려온 것이 아니라 <b>한 곳이 막혔을 때 시연이 멈추지 않게</b> 하려고 데려왔다.
 * 어느 쪽이 나은지는 `bench:assist`를 공급자별로 돌려 정한다 (AI-10).
 *
 * <p>OpenAI 호환 엔드포인트라 같은 모양의 요청을 쓴다. 그래서 이 파일은 DeepSeek 전용이
 * 아니라 <b>OpenAI 호환이면 무엇이든</b> 붙는다 — `baseUrl`과 `model`만 바꾸면 된다.
 * 국내 벤더로 옮길 때 이 성질이 값을 한다.
 *
 * <p>키 취급은 `gemini.ts`와 같다 — 환경변수를 먼저 보고, 오류 본문에서 키를 가리고,
 * 이 모듈 밖으로 키가 나가는 경로를 만들지 않는다 (절대 보호선 규칙 7).
 *
 * <p><b>스키마를 강제하지 못한다.</b> JSON 모드는 "JSON이기만 하면 된다"까지만 보장하므로
 * 모양은 프롬프트로 부탁한다(`describeSchema`). 돌려받은 것은 어차피 `validateProposal`을
 * 지나므로, 여기서 모양이 어긋나도 화면에 닿지 않는다.
 */

const DEFAULT_BASE_URL = "https://api.deepseek.com";

export interface DeepSeekOptions {
  model?: string;
  /** OpenAI 호환이면 무엇이든. 기본은 DeepSeek. */
  baseUrl?: string;
  /** 요청 사이 최소 간격(ms). 429가 나면 스스로 늘린다 — `gemini.ts`와 같은 방식. */
  spacingMs?: number;
  onNote?: (message: string) => void;
}

/** 환경변수에서 키를 읽는다. 없으면 `null` — 공급자를 안 만들면 그만이다. */
export function readDeepSeekKey(): string | null {
  const key = process.env["DEEPSEEK_API_KEY"];
  return key && key.trim().length > 0 ? key.trim() : null;
}

export class DeepSeek implements LlmClient {
  readonly name: string;

  readonly #key: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #note: (message: string) => void;
  #spacing: number;
  #lastCallAt = 0;

  constructor(key: string, options: DeepSeekOptions = {}) {
    this.#key = key;
    this.#model = options.model ?? "deepseek-chat";
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#spacing = options.spacingMs ?? 1_000;
    this.#note = options.onNote ?? (() => {});
    this.name = this.#model;
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
        throw new Error(`DeepSeek ${response.status}: ${text.slice(0, 300)}`);
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

    throw new Error("DeepSeek 한도에 계속 걸립니다.");
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
