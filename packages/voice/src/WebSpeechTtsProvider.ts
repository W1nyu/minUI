import { maskDigits, type TtsProvider } from "./TtsProvider.js";

/**
 * 브라우저 `speechSynthesis` 구현체 (F16).
 *
 * <p>고른 이유가 Web Speech STT와 같다 — <b>비용 0이고 번들이 0KB 는다.</b> 음성 모델을
 * 내려받는 순간 첫 화면이 늦어지고, M11에서 온디바이스 Whisper를 뺀 이유가 그것이었다.
 * 읽어 주기는 접근성 기능이라 <b>느리면 안 쓴다.</b>
 *
 * <p>지원하지 않는 브라우저에서는 `isSupported`가 false가 되고 호스트가 버튼을 안 그린다.
 * 눌러도 아무 일 없는 버튼을 남기는 것보다 낫다 — `assist` 엔드포인트가 없을 때
 * 호출 경로를 아예 안 만드는 것과 같은 판단이다.
 */
export interface WebSpeechTtsOptions {
  lang?: string;
  /** 말 속도. 1.0이 기본이고, 고령 사용자에게는 조금 느린 편이 낫다. */
  rate?: number;
  /** 이어진 숫자를 끝 네 자리만 읽을 것인가. **기본은 가린다.** */
  maskLongDigits?: boolean;
}

export class WebSpeechTtsProvider implements TtsProvider {
  readonly #lang: string;
  readonly #rate: number;
  readonly #mask: boolean;

  constructor(options: WebSpeechTtsOptions = {}) {
    this.#lang = options.lang ?? "ko-KR";
    /*
     * 0.95. 기본(1.0)보다 아주 조금 느리다.
     *
     * 더 낮추면 또박또박해지는 대신 확인 문구 한 줄이 길어져 사람이 중간에 끊는다.
     * **재지 않은 값이다** — 사용자 테스트에서 가장 먼저 물어볼 값 중 하나.
     */
    this.#rate = options.rate ?? 0.95;
    this.#mask = options.maskLongDigits ?? true;
  }

  get isSupported(): boolean {
    return typeof globalThis !== "undefined" && "speechSynthesis" in globalThis;
  }

  speak(text: string): void {
    const synth = getSynth();
    if (!synth) return;

    // 겹쳐 읽으면 둘 다 안 들린다. 새 요청이 언제나 이긴다.
    synth.cancel();

    const utterance = new (globalThis as unknown as {
      SpeechSynthesisUtterance: new (text: string) => SpeechSynthesisUtteranceLike;
    }).SpeechSynthesisUtterance(this.#mask ? maskDigits(text) : text);
    utterance.lang = this.#lang;
    utterance.rate = this.#rate;
    synth.speak(utterance);
  }

  cancel(): void {
    getSynth()?.cancel();
  }
}

interface SpeechSynthesisUtteranceLike {
  lang: string;
  rate: number;
}

interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
}

/** 브라우저 전역은 이 파일 안에서만 만진다 (폴더 규칙). */
function getSynth(): SpeechSynthesisLike | null {
  const scope = globalThis as unknown as {
    speechSynthesis?: SpeechSynthesisLike;
    SpeechSynthesisUtterance?: unknown;
  };
  if (!scope.speechSynthesis || !scope.SpeechSynthesisUtterance) return null;
  return scope.speechSynthesis;
}
