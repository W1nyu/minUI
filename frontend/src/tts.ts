import { WebSpeechTtsProvider, type TtsProvider } from "@minui/voice";

/**
 * 읽어 주기 엔진 — 브라우저 `speechSynthesis` 하나 (F16).
 *
 * <p>`makeStt`와 같은 자리에 같은 이유로 둔다. 상용 전환 시 국내 TTS로 바꿀 때 고칠
 * 것은 이 한 줄이고, 그것이 Provider를 둔 이유다.
 *
 * <p>계좌번호를 통째로 읽지 않는 기본값(`maskLongDigits`)은 구현체에 있다. 여기서
 * 끄지 않는다 — 끄고 싶은 사용자는 나중에 화면에서 고를 수 있게 하는 편이 낫고,
 * 기본값이 조용한 쪽이어야 한다.
 */
export function makeTts(): TtsProvider {
  return new WebSpeechTtsProvider();
}
