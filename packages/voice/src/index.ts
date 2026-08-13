export {
  Listeners,
  type SttError,
  type SttErrorCode,
  type SttProvider,
  type SttResult,
} from "./SttProvider.js";
export { WebSpeechSttProvider, type WebSpeechOptions } from "./WebSpeechSttProvider.js";
export { MockSttProvider, type ScriptedUtterance } from "./MockSttProvider.js";
export {
  WhisperSttProvider,
  type MicRecorder,
  type WhisperEngine,
  type WhisperSttOptions,
} from "./WhisperSttProvider.js";
export { BrowserMicRecorder } from "./BrowserMicRecorder.js";
export { FallbackSttProvider } from "./FallbackSttProvider.js";
/*
 * `TransformersWhisperEngine`(즉시 로딩)은 여기서 내보내지 않는다.
 * 정적으로 들어오면 onnxruntime WASM 23MB가 첫 화면 번들에 얹힌다 — 실측했다.
 * 호스트는 아래 지연 로딩 판을 쓰고, 즉시 로딩이 필요하면 `@minui/voice/whisper`에서
 * 직접 받는다.
 */
export { lazyTransformersEngine, type LazyWhisperEngine } from "./lazyWhisper.js";
export type { TransformersWhisperOptions } from "./whisper.js";
