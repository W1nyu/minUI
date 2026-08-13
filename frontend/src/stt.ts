import {
  BrowserMicRecorder,
  FallbackSttProvider,
  WebSpeechSttProvider,
  WhisperSttProvider,
  lazyTransformersEngine,
  type SttProvider,
} from "@minui/voice";

/**
 * 음성 엔진 — **Web Speech가 주, Whisper는 예비** (`demos/src/stt.ts`와 같은 판단).
 *
 * <p>두 엔진을 번갈아 써 보고 Web Speech로 정했다. Whisper를 남겨 두는 이유는
 * 파이어폭스처럼 Web Speech가 <b>아예 없는 자리</b>가 있기 때문이지 정확도가 아니다.
 *
 * <p>둘 다 안 되면 텍스트 검색이 그대로 남는다. 음성은 보조 경로이지 유일 경로가 아니다.
 *
 * <p>측정에서는 이것을 쓰지 않는다 — `App`이 스크립트된 발화를 주입해 마이크 없이
 * 음성 경로를 잰다.
 */
export function makeStt(): SttProvider {
  return new FallbackSttProvider([
    new WebSpeechSttProvider(),
    new WhisperSttProvider({
      // 모델은 마이크를 처음 누를 때 받는다. 첫 화면에 23MB를 얹지 않는다(§14).
      engine: lazyTransformersEngine(),
      recorder: new BrowserMicRecorder(),
    }),
  ]);
}
