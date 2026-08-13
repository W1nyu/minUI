import {
  Listeners,
  type SttError,
  type SttProvider,
  type SttResult,
} from "./SttProvider.js";

/**
 * 온디바이스 Whisper 구현체 (기획안 §9.1의 "로컬 검증" 단계).
 *
 * <p>Web Speech와 갈라지는 지점은 하나다 — <b>발화가 기기 밖으로 나가지 않는다.</b>
 * Chrome의 Web Speech는 음성을 구글 서버로 보내는데, 금융 앱에서 그것은 §11.4가
 * 넘어야 할 문턱이다. 여기서는 모델이 브라우저 안에서 돈다.
 *
 * <p>대신 두 가지를 잃는다. 정직하게 적어 둔다.
 * <ul>
 *   <li><b>중간 결과가 없다.</b> Whisper는 스트리밍이 아니라 말이 끝난 뒤 한 번에
 *       옮긴다. 말하는 동안 화면에 흐르던 글자가 사라지므로, 호스트는 "듣고 있어요"를
 *       다른 방법으로 보여 줘야 한다
 *   <li><b>신뢰도가 없다.</b> 1로 채운다 — 신뢰도를 주지 않는 브라우저를 1로 두기로 한
 *       `WebSpeechSttProvider`의 판단과 같다. §9.2의 낮은 신뢰도 되묻기는 이 구현체에서
 *       작동하지 않고, <b>§9.3의 위험도 규칙이 여전히 자동 실행을 막는다</b>
 * </ul>
 *
 * <p>모델을 이 패키지가 들고 있지 않은 것이 의도다. `WhisperEngine`은 주입받는 구멍이고,
 * 호스트가 무엇을 끼울지 정한다 — transformers.js든 whisper.cpp WASM이든 상용 API든
 * <b>바뀌는 코드는 그 파일 하나다</b>(§9.1). 그래서 `@minui/voice`의 의존성은 0으로 남는다.
 */

/** 16kHz mono PCM을 글자로 옮기는 것. 무엇으로 옮기는지는 이 패키지가 모른다. */
export interface WhisperEngine {
  transcribe(audio: Float32Array): Promise<string>;
}

/** 마이크. 브라우저 API를 이 인터페이스 뒤에 두면 구현체를 테스트할 수 있다. */
export interface MicRecorder {
  readonly isSupported: boolean;
  start(): Promise<void>;
  /** 녹음을 끝내고 16kHz mono PCM을 돌려준다. */
  stop(): Promise<Float32Array>;
}

export interface WhisperSttOptions {
  engine: WhisperEngine;
  recorder: MicRecorder;
}

export class WhisperSttProvider implements SttProvider {
  readonly #engine: WhisperEngine;
  readonly #recorder: MicRecorder;
  readonly #partial = new Listeners<string>();
  readonly #final = new Listeners<SttResult>();
  readonly #error = new Listeners<SttError>();
  #recording = false;

  constructor(options: WhisperSttOptions) {
    this.#engine = options.engine;
    this.#recorder = options.recorder;
  }

  get isSupported(): boolean {
    return this.#recorder.isSupported;
  }

  async start(): Promise<void> {
    if (this.#recording) return;
    try {
      await this.#recorder.start();
      this.#recording = true;
    } catch {
      /*
       * 마이크가 안 열리는 이유는 거의 언제나 권한이다. 원인을 코드로 갈라 봐야
       * 사용자가 할 일은 같으므로(권한을 주거나 글로 입력하거나) 한 갈래로 둔다.
       */
      this.#error.emit({
        code: "permission-denied",
        message: "마이크를 쓸 수 없습니다.",
      });
    }
  }

  /**
   * 녹음을 끝내고 옮긴다.
   *
   * <p>`stop()`과 나눈 이유: `stop()`은 <b>버리고 끝내는</b> 것이고(사용자가 취소),
   * 이쪽은 <b>끝내고 결과를 받는</b> 것이다. 스트리밍 구현체에서는 둘이 같지만
   * 여기서는 다르다 — 말이 끝나야 비로소 옮기기 시작하기 때문이다.
   */
  async finish(): Promise<void> {
    if (!this.#recording) return;
    this.#recording = false;

    let audio: Float32Array;
    try {
      audio = await this.#recorder.stop();
    } catch {
      this.#error.emit({ code: "unknown", message: "녹음을 마치지 못했습니다." });
      return;
    }

    try {
      const text = (await this.#engine.transcribe(audio)).trim();
      if (text.length === 0) {
        this.#error.emit({ code: "no-speech", message: "아무 말도 들리지 않았습니다." });
        return;
      }
      this.#final.emit({ text, confidence: 1 });
    } catch {
      // 모델을 못 받았거나 죽었다. 화면은 살아 있어야 하고, 텍스트 입력이 그대로 있다.
      this.#error.emit({ code: "unknown", message: "옮기지 못했습니다." });
    }
  }

  /** 버리고 끝낸다. 결과를 내지 않는다. */
  stop(): void {
    if (!this.#recording) return;
    this.#recording = false;
    void this.#recorder.stop().catch(() => {});
  }

  onPartial(callback: (text: string) => void): () => void {
    // 스트리밍이 아니라 부를 일이 없다. 계약을 지키기 위해 구독은 받는다.
    return this.#partial.add(callback);
  }

  onFinal(callback: (result: SttResult) => void): () => void {
    return this.#final.add(callback);
  }

  onError(callback: (error: SttError) => void): () => void {
    return this.#error.add(callback);
  }
}
