export {
  Listeners,
  type SttError,
  type SttErrorCode,
  type SttProvider,
  type SttResult,
} from "./SttProvider.js";
export { WebSpeechSttProvider, type WebSpeechOptions } from "./WebSpeechSttProvider.js";
export { MockSttProvider, type ScriptedUtterance } from "./MockSttProvider.js";
/*
 * 엔진은 하나다 — 브라우저 Web Speech (기획안 §9.1).
 *
 * 온디바이스 Whisper를 예비로 뒀다가 M11에서 뺐다. 두 가지가 겹쳤다.
 * `whisper-base`(q8)는 한국어에서 Web Speech보다 못했고, 그것 하나를 위해 가중치 78MB와
 * onnxruntime WASM 23MB가 따라왔다. **더 나쁜 것에 그 값을 치를 이유가 없다.**
 * 왜 처음에 뒀고 왜 뺐는지는 §16에 그대로 남아 있다 — 지우면 다음 사람이 다시 시도한다.
 *
 * 예비가 사라졌다고 막다른 길이 생기지는 않는다. Web Speech가 없는 브라우저에서는
 * `isSupported`가 false가 되고 호스트가 텍스트 검색만 보여 준다. 그것이 원래부터
 * 마지막 대안이었다.
 */
