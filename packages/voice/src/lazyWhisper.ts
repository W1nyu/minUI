import type { WhisperEngine } from "./WhisperSttProvider.js";
import type { TransformersWhisperOptions } from "./whisper.js";

/**
 * Whisper 엔진을 **처음 쓸 때** 불러온다.
 *
 * <p>정적으로 `@minui/voice/whisper`를 import하면 onnxruntime의 WASM(23MB)이 첫 화면
 * 번들에 들어간다. 실측했다 — 데모 번들이 0.3MB에서 25MB가 됐다.
 * <b>음성을 한 번도 안 누른 사람까지 그것을 받는다.</b>
 *
 * <p>이 프로젝트는 "임베딩 모델 100MB 대신 n-gram 색인 29.6KB"를 근거로 온디바이스를
 * 주장해 왔다(§14). 첫 화면에 23MB를 얹으면 그 주장이 무너진다. 동적 import로 갈라 두면
 * 번들러가 따로 떼어 내고, <b>마이크를 처음 누른 사람만</b> 그 값을 치른다.
 *
 * <p>대가는 첫 발화가 느려지는 것이다. 그래서 `warmUp()`을 열어 둔다 — 호스트가
 * "음성으로 찾기"를 연 시점처럼 <b>쓸 것이 확실해진 순간</b> 미리 부를 수 있다.
 */
export interface LazyWhisperEngine extends WhisperEngine {
  /** 모델을 미리 받아 둔다. 부르지 않아도 첫 발화 때 알아서 받는다. */
  warmUp(): Promise<void>;
}

export function lazyTransformersEngine(
  options: TransformersWhisperOptions = {},
): LazyWhisperEngine {
  let engine: Promise<WhisperEngine> | null = null;

  const load = (): Promise<WhisperEngine> => {
    engine ??= import("./whisper.js").then(
      (module) => new module.TransformersWhisperEngine(options),
    );
    return engine;
  };

  return {
    async warmUp() {
      await load();
    },
    async transcribe(audio) {
      return (await load()).transcribe(audio);
    },
  };
}
