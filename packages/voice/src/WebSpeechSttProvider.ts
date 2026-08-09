import {
  Listeners,
  type SttError,
  type SttErrorCode,
  type SttProvider,
  type SttResult,
} from "./SttProvider.js";

/**
 * 브라우저 Web Speech API 구현체 — 개발·데모용 (기획안 §9.1).
 *
 * 비용이 0이라 프로토타이핑에 적합하지만, 브라우저에 따라 발화가 외부 서버로
 * 전송된다. 실서비스에서는 온디바이스 또는 국내 벤더 엔진으로 교체해야 하며,
 * 그것이 이 인터페이스를 둔 이유다.
 *
 * 인식된 텍스트는 검색에 쓰고 나면 버린다. 저장하거나 로그에 남기지 않는다
 * (기획안 §11.2). 음성 원본은 이 구현체가 애초에 접근하지 않는다.
 */
export interface WebSpeechOptions {
  /** 인식 언어. 기본 한국어. */
  lang?: string;
}

export class WebSpeechSttProvider implements SttProvider {
  readonly #lang: string;
  readonly #partial = new Listeners<string>();
  readonly #final = new Listeners<SttResult>();
  readonly #error = new Listeners<SttError>();
  #recognition: SpeechRecognitionLike | null = null;

  constructor(options: WebSpeechOptions = {}) {
    this.#lang = options.lang ?? "ko-KR";
  }

  get isSupported(): boolean {
    return getConstructor() !== undefined;
  }

  async start(): Promise<void> {
    const Recognition = getConstructor();
    if (!Recognition) {
      this.#error.emit({
        code: "not-supported",
        message: "이 브라우저에서는 음성 인식을 쓸 수 없습니다.",
      });
      return;
    }

    this.stop();

    const recognition = new Recognition();
    recognition.lang = this.#lang;
    // 중간 결과를 받아 두면 사용자가 말하는 동안 이미 후보를 좁힐 수 있다.
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alternative = result?.[0];
        if (!alternative) continue;

        if (result.isFinal) {
          this.#final.emit({
            text: alternative.transcript,
            // 신뢰도를 주지 않는 브라우저가 있다. 없으면 판단을 미루지 않고 1로 둔다 —
            // 대신 §9.3의 위험도 규칙이 여전히 자동 실행을 막는다.
            confidence: alternative.confidence > 0 ? alternative.confidence : 1,
          });
        } else {
          this.#partial.emit(alternative.transcript);
        }
      }
    };

    recognition.onerror = (event) => {
      this.#error.emit({ code: mapErrorCode(event.error), message: event.error });
    };

    recognition.onend = () => {
      this.#recognition = null;
    };

    this.#recognition = recognition;
    recognition.start();
  }

  /** 마이크는 버튼을 누른 동안만 열린다. 상시 대기 웨이크워드는 채용하지 않았다 (§11.2). */
  stop(): void {
    if (!this.#recognition) return;
    this.#recognition.onresult = null;
    this.#recognition.onerror = null;
    this.#recognition.onend = null;
    this.#recognition.abort();
    this.#recognition = null;
  }

  onPartial(callback: (text: string) => void): () => void {
    return this.#partial.add(callback);
  }

  onFinal(callback: (result: SttResult) => void): () => void {
    return this.#final.add(callback);
  }

  onError(callback: (error: SttError) => void): () => void {
    return this.#error.add(callback);
  }
}

function mapErrorCode(raw: string): SttErrorCode {
  switch (raw) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    default:
      return "unknown";
  }
}

// ── 브라우저 타입 ────────────────────────────────────────────────────────
// 표준화 전 API라 TypeScript 기본 라이브러리에 없다. 쓰는 만큼만 선언한다.

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike | undefined;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof globalThis === "undefined") return undefined;
  const scope = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}
