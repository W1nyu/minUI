import { WebSpeechSttProvider, type SttProvider } from "@minui/voice";

/**
 * 음성 엔진 — **브라우저 Web Speech 하나** (기획안 §9.1).
 *
 * <p>M11 전까지는 여기서 엔진을 골랐다. 주는 Web Speech, 예비는 온디바이스 Whisper였고
 * `?stt=whisper`로 뒤집어 예비 경로가 실제로 도는지 확인할 수 있었다 —
 * <b>한 번도 안 도는 예비 경로는 예비가 아니다</b>가 그 손잡이의 근거였다.
 *
 * <p>그 근거는 여전히 맞다. 다만 <b>예비 자체를 없앴다.</b> `whisper-base`(q8)는 한국어에서
 * Web Speech보다 못했는데, 그것 하나 때문에 가중치 78MB와 onnxruntime WASM 23MB가 따라왔다.
 * 더 나쁜 것에 그 값을 치를 이유가 없다. 왜 처음에 뒀고 왜 뺐는지는 §16에 남겨 뒀다.
 *
 * <p><b>둘 다 안 되면 텍스트 검색이 그대로 남는다</b>는 것은 안 바뀌었다. 음성은 보조
 * 경로이지 유일 경로가 아니고, `isSupported`가 false면 화면이 그렇게 대응한다.
 */
export function makeStt(): SttProvider {
  return new WebSpeechSttProvider();
}
