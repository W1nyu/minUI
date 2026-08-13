import { env, pipeline } from "@huggingface/transformers";
import type { WhisperEngine } from "./WhisperSttProvider.js";

/**
 * transformers.js로 Whisper를 브라우저 안에서 돌린다.
 *
 * <p><b>이 파일은 따로 떨어져 있다</b>(`@minui/voice/whisper`). `@minui/voice`의 본 진입점은
 * 의존성이 없어야 하기 때문이다 — Whisper를 안 쓰는 호스트가 onnxruntime을 받을 이유가
 * 없다. 이 경로를 import한 호스트만 그 값을 치른다.
 *
 * <p>기획안 §9.1이 "whisper.cpp 계열 로컬 모델"이라고 적은 자리다. 런타임이 whisper.cpp가
 * 아니라 ONNX Runtime인 것은 <b>브라우저에서 검증 가능한 배포본이 있느냐</b>의 차이일 뿐,
 * 모델은 같은 Whisper다. whisper.cpp WASM으로 바꾸려면 이 파일 하나를 갈면 된다 —
 * `WhisperEngine`은 `Float32Array`를 받아 문자열을 주는 것이 전부다.
 *
 * <h3>고르는 값들</h3>
 *
 * <p><b>모델.</b> 기본값 `whisper-base`는 한국어에서 넉넉하지 않다. `small`이면 눈에 띄게
 * 나아지지만 받는 양이 3배가 된다(§14 번들 리스크). 호스트가 이 엔진을 <b>주로</b> 쓸
 * 생각이라면 키워야 하고, 예비로만 둘 생각이라면 그럴 이유가 없다. 그래서
 * <b>기본값을 작게 잡되 바꿀 수 있게</b> 열어 둔다.
 *
 * <p><b>언어를 한국어로 못박는다.</b> Whisper는 언어를 스스로 알아맞히는데, 짧은 발화
 * ("잔액")에서 자주 틀린다. 금융 앱에서 쓸 말이 한국어인 것은 아는 사실이라 짐작하게
 * 두지 않는다.
 */

export interface TransformersWhisperOptions {
  /** Hugging Face 모델 id. */
  model?: string;
  /** 가중치 정밀도. `q8`이 받는 양과 정확도의 타협점이다. */
  dtype?: "fp32" | "fp16" | "q8" | "q4";
  /** `webgpu`가 되면 훨씬 빠르다. 안 되면 `wasm`으로 떨어진다. */
  device?: "webgpu" | "wasm";
  /**
   * 호스트가 직접 서빙하는 모델 경로. 예: `"/models/"`.
   *
   * <p>주면 <b>거기를 먼저 보고</b>, 없으면 Hugging Face CDN에서 받는다. 시연이 남의
   * 서버에 걸리지 않게 하고, 측정이 매번 같은 가중치로 재현되게 하는 장치다
   * (`tools/src/fetch-whisper-model.ts`가 그 파일들을 만든다).
   */
  localPath?: string;
  /** 진행 상황. 모델을 처음 받을 때 수십 초가 걸리므로 호스트가 알려 줘야 한다. */
  onProgress?: (percent: number) => void;
}

type Asr = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string } | { text?: string }[]>;

export class TransformersWhisperEngine implements WhisperEngine {
  readonly #options: Required<
    Omit<TransformersWhisperOptions, "onProgress" | "localPath">
  >;
  readonly #localPath: string | undefined;
  readonly #onProgress: (percent: number) => void;
  /** 한 번만 받는다. 두 번째 발화부터는 즉시 시작한다. */
  #loading: Promise<Asr> | null = null;

  constructor(options: TransformersWhisperOptions = {}) {
    this.#options = {
      model: options.model ?? "onnx-community/whisper-base",
      dtype: options.dtype ?? "q8",
      device: options.device ?? (hasWebGpu() ? "webgpu" : "wasm"),
    };
    this.#localPath = options.localPath;
    this.#onProgress = options.onProgress ?? (() => {});
  }

  /** 모델을 미리 받아 둔다. 첫 발화에서 기다리지 않게 하려면 호스트가 일찍 부른다. */
  async warmUp(): Promise<void> {
    await this.#load();
  }

  async transcribe(audio: Float32Array): Promise<string> {
    if (audio.length === 0) return "";
    const asr = await this.#load();

    const output = await asr(audio, {
      language: "korean",
      task: "transcribe",
      // 메뉴를 부르는 말은 짧다. 길게 열어 두면 헛것을 지어내는 시간만 늘어난다.
      chunk_length_s: 30,
      return_timestamps: false,
    });

    const first = Array.isArray(output) ? output[0] : output;
    return first?.text?.trim() ?? "";
  }

  #load(): Promise<Asr> {
    /*
     * 로컬을 먼저 보되 CDN을 막지는 않는다. 호스트가 모델을 안 받아 뒀을 때
     * 음성이 통째로 죽는 것보다, 느리더라도 도는 편이 낫다.
     */
    if (this.#localPath) {
      env.allowLocalModels = true;
      env.localModelPath = this.#localPath;
    }

    this.#loading ??= pipeline("automatic-speech-recognition", this.#options.model, {
      dtype: this.#options.dtype,
      device: this.#options.device,
      progress_callback: (event: { status?: string; progress?: number }) => {
        if (event.status === "progress" && typeof event.progress === "number") {
          this.#onProgress(Math.round(event.progress));
        }
      },
    }) as unknown as Promise<Asr>;
    return this.#loading;
  }
}

function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
