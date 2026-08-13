import {
  BrowserMicRecorder,
  FallbackSttProvider,
  WebSpeechSttProvider,
  WhisperSttProvider,
  lazyTransformersEngine,
  type SttProvider,
} from "@minui/voice";

/**
 * 음성 엔진 — **브라우저가 주, 온디바이스가 예비** (`demos/src/stt.ts`와 같은 판단).
 *
 * <p>Web Speech가 앞인 근거는 확인된 것뿐이다 — 즉시 동작하고, 받을 것이 없고,
 * 한국어가 검증돼 있다. Whisper가 고령 발화에서 더 나은지는 §12.2-C를 재 봐야 안다.
 * 예비로 두는 이유는 파이어폭스처럼 Web Speech가 아예 없는 자리가 있기 때문이다.
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
