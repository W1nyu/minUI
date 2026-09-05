import {
  Listeners,
  type SttError,
  type SttPhrase,
  type SttProvider,
  type SttResult,
} from "./SttProvider.js";

/** 재생할 발화 하나. 중간 결과와 최종 결과를 흉내 낸다. */
export interface ScriptedUtterance {
  /** 중간 인식 결과들. 사용자가 말하는 동안 나오는 것. */
  partials?: string[];
  text: string;
  /** 0..1. 저품질 STT를 흉내 내려면 낮게 준다. */
  confidence?: number;
  /**
   * 같은 발화에 대한 다른 후보들 (M21). `text`를 첫 칸으로 앞에 붙여 낸다.
   *
   * <p>실제 브라우저 없이 N-best 경로를 검증하려면 이것이 필요하다.
   */
  alternatives?: string[];
  /** 이 발화 대신 오류를 낸다. */
  error?: SttError;
  /**
   * 최종 결과를 자동으로 내지 않고 `finish()`를 기다린다.
   *
   * 실제 발화는 "말하는 중"과 "말이 끝남" 사이에 시간이 흐른다. 테스트에서
   * 그 중간 상태(마이크가 열려 있고 들은 말이 화면에 보이는 상태)를 관찰하려면
   * 최종 결과가 즉시 따라오면 안 된다.
   */
  holdFinal?: boolean;
}

/**
 * 스크립트된 발화를 재생하는 구현체.
 *
 * 두 가지 목적이 있다.
 *   ① 테스트 — 마이크 없이 음성 경로 전체를 검증한다.
 *   ② 벤치마크 — 같은 발화 세트를 여러 Provider에 태워 비교할 때 기준선이 된다
 *      (기획안 §12.2-C). 인식률 100%인 가상 STT가 있어야 "검색이 못 찾은 것"과
 *      "STT가 못 알아들은 것"을 갈라 볼 수 있다.
 */
export class MockSttProvider implements SttProvider {
  readonly isSupported = true;

  readonly #partial = new Listeners<string>();
  readonly #final = new Listeners<SttResult>();
  readonly #error = new Listeners<SttError>();
  #script: ScriptedUtterance[];
  #index = 0;
  #running = false;
  #held: ScriptedUtterance | null = null;
  /** 마지막으로 받은 편향 목록 (M22). 테스트가 배선을 확인하는 데 쓴다. */
  phrases: readonly SttPhrase[] = [];
  /** 기기 안에서 돌라는 요청을 받았는가 (M22). */
  wantsLocal = false;

  constructor(script: ScriptedUtterance[] = []) {
    this.#script = [...script];
  }

  /** 다음에 재생할 발화를 바꾼다. 테스트에서 한 인스턴스를 재사용할 때 쓴다. */
  setScript(script: ScriptedUtterance[]): void {
    this.#script = [...script];
    this.#index = 0;
  }

  async start(): Promise<void> {
    this.#running = true;
    const utterance = this.#script[this.#index];
    this.#index += 1;

    if (!utterance) {
      this.#error.emit({ code: "no-speech", message: "재생할 발화가 없습니다." });
      return;
    }

    for (const partial of utterance.partials ?? []) {
      if (!this.#running) return;
      this.#partial.emit(partial);
    }

    if (!this.#running) return;

    if (utterance.error) {
      this.#error.emit(utterance.error);
      return;
    }

    if (utterance.holdFinal === true) {
      this.#held = utterance;
      return;
    }

    this.#final.emit(toResult(utterance));
  }

  setPhrases(phrases: readonly SttPhrase[]): void {
    this.phrases = phrases;
  }

  preferLocal(value: boolean): void {
    this.wantsLocal = value;
  }

  /** `holdFinal`로 붙잡아 둔 최종 결과를 내보낸다. */
  finish(): void {
    const utterance = this.#held;
    this.#held = null;
    if (!utterance || !this.#running) return;

    this.#final.emit(toResult(utterance));
  }

  stop(): void {
    this.#running = false;
    this.#held = null;
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

/** 스크립트 한 줄을 인식 결과로 옮긴다. 대안이 있으면 `text`를 1순위로 앞에 세운다. */
function toResult(utterance: ScriptedUtterance): SttResult {
  const confidence = utterance.confidence ?? 1;
  if (!utterance.alternatives || utterance.alternatives.length === 0) {
    return { text: utterance.text, confidence };
  }

  const texts = [utterance.text, ...utterance.alternatives];
  const seen = new Set<string>();
  const alternatives = texts
    .filter((text) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .map((text) => ({ text, confidence }));

  return { text: utterance.text, confidence, alternatives };
}
