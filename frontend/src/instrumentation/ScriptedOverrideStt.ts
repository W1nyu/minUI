import type { SttLike } from "@minui/react";

/**
 * 진행자가 최종 전사를 한 번 갈아끼울 수 있게 실제 STT를 감싼다
 * (기획안 §12.10의 F9 프로토콜).
 *
 * <p>F9가 물으려는 것은 <b>참가자가 말한 금액과 다른 금액</b>이 제안으로 떴을 때
 * 그것을 잡아내는가이다. 실제 마이크로는 그 상황을 만들 수 없고, 우연히 오인식이
 * 나기를 기다릴 수도 없다.
 *
 * <p><b>통째로 바꾸지 않고 감싼다.</b> `MockSttProvider`로 교체하면 F9 과제만 따로
 * 열어야 하는데, 새로 열면 `minuiMetrics`가 메모리에 들고 있던 그때까지의 기록이
 * 날아간다. 감싸면 마이크는 그대로 열리고, 참가자는 평소처럼 말하고, 중간 결과로
 * 자기 말을 본다. 갈리는 것은 최종 전사 한 번뿐이다.
 *
 * <p>실제 인식이 <b>실패해도</b> 넣어 둔 문장을 내보낸다. 고령 발화에서 STT가 흔들리는
 * 것은 흔한 일이고, 그때마다 프로토콜이 무너지면 F9를 잴 기회가 사라진다.
 */
export class ScriptedOverrideStt implements SttLike {
  readonly #inner: SttLike;
  readonly #partial = new Set<(text: string) => void>();
  readonly #final = new Set<(result: { text: string; confidence: number }) => void>();
  readonly #error = new Set<(error: { code: string; message: string }) => void>();

  #queued: string | null = null;

  /** 감싼 엔진이 끝을 알려 줘야 하는 종류일 때만 생긴다 (`SttLike.finish`). */
  finish?: () => void | Promise<void>;

  constructor(inner: SttLike) {
    this.#inner = inner;

    inner.onPartial((text) => {
      for (const listener of this.#partial) listener(text);
    });

    inner.onFinal((result) => {
      const override = this.#take();
      this.#emitFinal(override === null ? result : { text: override, confidence: 1 });
    });

    inner.onError((error) => {
      const override = this.#take();
      if (override === null) {
        for (const listener of this.#error) listener(error);
        return;
      }
      this.#emitFinal({ text: override, confidence: 1 });
    });

    // 있을 때만 단다. 없는데 만들면 화면에 "끝내기" 버튼이 생겨 기본 경로와 달라진다.
    if (inner.finish) this.finish = () => this.#finish();
  }

  /**
   * "다 말했어요"를 눌렀을 때.
   *
   * <p><b>조용히 끝나는 엔진이 있다.</b> `WebSpeechSttProvider`에는 `finish()`가 없어서
   * `FallbackSttProvider.finish()`가 `stop()`으로 내려가고, `stop()`은 핸들러를 전부
   * null로 만들고 abort한다 — 최종 결과도 오류도 나오지 않는다. 참가자가 말없이,
   * 혹은 너무 작게 말하고 버튼을 누르면 정확히 이 경로다.
   *
   * <p>그래서 넣어 둔 것이 있으면 <b>감싼 쪽을 기다리지 않고 여기서 내보낸다.</b>
   * 기다리면 영영 안 온다. 마이크는 닫는다 — 열어 둔 채 결과만 내보내면 화면의
   * 마이크 불이 켜진 채로 남는다.
   */
  async #finish(): Promise<void> {
    const override = this.#take();
    if (override === null) {
      await this.#inner.finish?.();
      return;
    }
    this.#inner.stop();
    this.#emitFinal({ text: override, confidence: 1 });
  }

  get isSupported(): boolean {
    return this.#inner.isSupported;
  }

  /** 다음 최종 전사를 이 문장으로 바꾼다. 한 번 쓰면 소진된다. */
  next(text: string): void {
    this.#queued = text;
  }

  /** 넣어 둔 것을 되돌린다. */
  clear(): void {
    this.#queued = null;
  }

  start(): Promise<void> {
    return this.#inner.start();
  }

  stop(): void {
    this.#inner.stop();
  }

  onPartial(callback: (text: string) => void): () => void {
    this.#partial.add(callback);
    return () => this.#partial.delete(callback);
  }

  onFinal(callback: (result: { text: string; confidence: number }) => void): () => void {
    this.#final.add(callback);
    return () => this.#final.delete(callback);
  }

  onError(callback: (error: { code: string; message: string }) => void): () => void {
    this.#error.add(callback);
    return () => this.#error.delete(callback);
  }

  #take(): string | null {
    const queued = this.#queued;
    this.#queued = null;
    return queued;
  }

  #emitFinal(result: { text: string; confidence: number }): void {
    for (const listener of this.#final) listener(result);
  }
}
