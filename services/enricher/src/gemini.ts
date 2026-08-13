import { readFileSync } from "node:fs";

/**
 * Gemini 호출. **무료 한도 안에서 도는 것이 전제다.**
 *
 * <p>유료 토큰을 쓰지 않기로 했으므로 분당 요청 수에 걸린다. 걸리면 429가 오고,
 * 그때 멈추는 대신 기다렸다 다시 건다. 무료 한도는 공개 값이 바뀌므로 코드에 박지 않고
 * <b>429를 보고 스스로 늦춘다</b> — 문서를 믿는 것보다 서버가 하는 말을 믿는 편이 낫다.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
  retries: number;
}

export interface GeminiOptions {
  model: string;
  /** 요청 사이 최소 간격(ms). 429가 나면 스스로 늘린다. */
  spacingMs?: number;
  onNote?: (message: string) => void;
}

/**
 * API 키를 읽는다. **환경변수를 먼저 본다.**
 *
 * <p>파일에 두는 것은 로컬 편의를 위한 것이고, 배포 환경에서는 환경변수여야 한다.
 * 어느 쪽이든 <b>키를 로그에 찍지 않는다</b> — 오류 메시지에 섞여 나가는 것이 가장 흔한
 * 유출 경로다. 그래서 이 모듈 밖으로 키가 나가는 경로를 만들지 않았다.
 */
export function readApiKey(filePath: string): string {
  const fromEnv = process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  try {
    const key = readFileSync(filePath, "utf8").trim();
    if (key.length > 0) return key;
  } catch {
    // 아래에서 함께 알린다.
  }
  throw new Error(
    `API 키가 없습니다. GOOGLE_API_KEY 환경변수를 두거나 ${filePath}에 키를 적으세요.`,
  );
}

export class Gemini {
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0, requests: 0, retries: 0 };

  readonly #key: string;
  readonly #model: string;
  readonly #note: (message: string) => void;
  #spacing: number;
  #lastCallAt = 0;

  constructor(key: string, options: GeminiOptions) {
    this.#key = key;
    this.#model = options.model;
    this.#spacing = options.spacingMs ?? 1_500;
    this.#note = options.onNote ?? (() => {});
  }

  get spacingMs(): number {
    return this.#spacing;
  }

  /**
   * JSON 응답을 요구하는 한 번의 생성.
   *
   * @param schema 응답 형태. 모델이 이 모양을 지키므로 파싱 실패가 크게 준다.
   */
  async json(system: string, user: string, schema: unknown): Promise<unknown> {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        // 호칭을 묻는 일이라 약간의 다양성은 있어야 하지만, 매번 달라지면 재현이 안 된다.
        temperature: 0.4,
      },
    };

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await this.#pace();

      const response = await fetch(`${ENDPOINT}/${this.#model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.#key },
        body: JSON.stringify(body),
      });

      if (response.status === 429 || response.status >= 500) {
        this.usage.retries += 1;
        // 한도에 걸렸으면 앞으로도 걸린다. 이번만 기다리지 말고 **간격 자체를 늘린다.**
        this.#spacing = Math.min(this.#spacing * 1.6, 30_000);
        const wait = Math.min(2_000 * 2 ** attempt, 60_000);
        this.#note(
          `한도(${response.status}) — ${Math.round(wait / 1000)}초 쉬고 간격을 ` +
            `${Math.round(this.#spacing)}ms로 늘립니다`,
        );
        await sleep(wait);
        continue;
      }

      if (!response.ok) {
        // 본문에 키가 섞여 돌아오는 경우가 있어 그대로 던지지 않는다.
        const text = (await response.text()).replace(this.#key, "<키>");
        throw new Error(`Gemini ${response.status}: ${text.slice(0, 300)}`);
      }

      const payload = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };

      this.usage.requests += 1;
      this.usage.inputTokens += payload.usageMetadata?.promptTokenCount ?? 0;
      this.usage.outputTokens += payload.usageMetadata?.candidatesTokenCount ?? 0;

      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (text.length === 0) return null;
      try {
        return JSON.parse(text);
      } catch {
        this.#note("응답이 JSON이 아닙니다 — 이 묶음은 건너뜁니다");
        return null;
      }
    }

    throw new Error("한도에 계속 걸립니다. 잠시 뒤 다시 시도하세요.");
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
