import { WebSpeechSttProvider, type SttProvider } from "@minui/voice";

/**
 * 음성 엔진 — **브라우저 Web Speech 하나** (기획안 §9.1).
 *
 * <p>한때 온디바이스 Whisper를 예비로 뒀다가 M11에서 뺐다. 예비를 둔 근거는 정확도가
 * 아니라 <b>Web Speech가 아예 없는 브라우저</b>였는데, 그 자리를 메우자고 치른 값이
 * 가중치 78MB와 onnxruntime WASM 23MB였다. `whisper-base`(q8)는 한국어에서 Web Speech보다
 * 못했으므로, <b>더 나쁜 것을 위해 그 값을 치른 셈</b>이다.
 *
 * <p>예비가 사라져도 막다른 길은 없다. `isSupported`가 false면 화면이 음성 버튼 대신
 * 텍스트 검색만 보여 준다 — 그것이 원래부터 마지막 대안이었고 지금도 그렇다.
 *
 * <p>측정에서는 이것을 쓰지 않는다 — `App`이 스크립트된 발화를 주입해 마이크 없이
 * 음성 경로를 잰다.
 */
export function makeStt(): SttProvider {
  return new WebSpeechSttProvider();
}
