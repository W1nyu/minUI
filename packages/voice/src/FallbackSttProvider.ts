import {
  Listeners,
  type SttError,
  type SttProvider,
  type SttResult,
} from "./SttProvider.js";

/**
 * 여러 엔진을 앞에서부터 시도한다 — **주 엔진과 예비 엔진.**
 *
 * <p>온디바이스 Whisper를 주로 쓰되, 못 쓰는 환경에서 음성이 통째로 사라지지 않게 한다.
 * 못 쓰는 이유는 여러 가지다: WebGPU도 WASM도 안 되는 브라우저, 모델 내려받기 실패,
 * 기기 메모리 부족. 그때 Web Speech로 넘어간다.
 *
 * <p><b>넘어가는 시점이 켤 때인 것이 중요하다.</b> 발화 도중에 엔진을 갈아타면 사용자는
 * 자기가 한 말이 어디로 갔는지 알 수 없다. 한번 고른 엔진은 세션 동안 유지하고,
 * 죽은 엔진은 다시 부르지 않는다.
 *
 * <p>권한 거부는 넘어갈 일이 아니다 — 어느 엔진이든 마이크는 같은 마이크라 다음 것도
 * 똑같이 거부당한다. 그래서 <b>시작에 실패한 경우만</b> 넘어가고, 시작한 뒤에 난 오류는
 * 그대로 호스트에 전한다.
 *
 * <p>전부 못 쓰면 `isSupported`가 false다. 호스트는 그것을 보고 음성 버튼 대신 텍스트
 * 검색만 노출한다 — 음성은 보조 경로이지 유일 경로가 아니다.
 */
export class FallbackSttProvider implements SttProvider {
  readonly #providers: readonly SttProvider[];
  readonly #partial = new Listeners<string>();
  readonly #final = new Listeners<SttResult>();
  readonly #error = new Listeners<SttError>();
  /** 켜 봤는데 죽은 것들. 다시 부르지 않는다. */
  readonly #dead = new Set<SttProvider>();
  #active: SttProvider | null = null;
  #unsubscribe: (() => void)[] = [];

  constructor(providers: readonly SttProvider[]) {
    this.#providers = providers;
  }

  get isSupported(): boolean {
    return this.#providers.some(
      (provider) => provider.isSupported && !this.#dead.has(provider),
    );
  }

  async start(): Promise<void> {
    for (const provider of this.#providers) {
      if (!provider.isSupported || this.#dead.has(provider)) continue;

      this.#attach(provider);
      try {
        await provider.start();
        return;
      } catch {
        // 켜 봐야 아는 실패(모델 내려받기 등). 이 엔진은 접고 다음으로 넘어간다.
        this.#dead.add(provider);
        this.#detach();
      }
    }

    this.#error.emit({
      code: "not-supported",
      message: "이 기기에서는 음성 인식을 쓸 수 없습니다.",
    });
  }

  stop(): void {
    this.#active?.stop();
  }

  /**
   * 켜져 있는 엔진이 `finish()`를 가졌으면 부른다.
   *
   * <p>Whisper처럼 말이 끝나야 옮기는 엔진에만 있다. 호스트가 어느 엔진이 켜졌는지
   * 알 필요 없이 "말 다 했어요"를 전할 수 있어야 해서 여기서 흡수한다.
   */
  async finish(): Promise<void> {
    const active = this.#active as { finish?: () => Promise<void> } | null;
    if (typeof active?.finish === "function") await active.finish();
    else this.#active?.stop();
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

  #attach(provider: SttProvider): void {
    this.#detach();
    this.#active = provider;
    this.#unsubscribe = [
      provider.onPartial((text) => this.#partial.emit(text)),
      provider.onFinal((result) => this.#final.emit(result)),
      provider.onError((error) => this.#error.emit(error)),
    ];
  }

  #detach(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#active = null;
  }
}
