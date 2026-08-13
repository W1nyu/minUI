import {
  BrowserMicRecorder,
  FallbackSttProvider,
  WebSpeechSttProvider,
  WhisperSttProvider,
  lazyTransformersEngine,
  type SttProvider,
} from "@minui/voice";

/**
 * 음성 엔진을 고르는 자리 — **브라우저가 주, 온디바이스가 예비.**
 *
 * <p>Web Speech를 앞에 둔 근거는 <b>지금 시점에 확인된 것만</b>이다. 크롬에서 즉시
 * 동작하고, 받을 것이 없어 첫 발화가 빠르며, 한국어 인식이 검증된 제품이다.
 * 반대로 Whisper를 앞에 둘 근거는 아직 없다 — `whisper-base`가 고령 발화에서
 * Web Speech보다 나은지 <b>재 보지 않았다</b>(§12.2-C). 재 보지도 않고 바꾸는 것은
 * 이 프로젝트가 여섯 번 되돌린 실험들과 같은 실수다.
 *
 * <p>Whisper는 예비로 둔다. Web Speech가 없는 자리가 실제로 있다 — 파이어폭스는
 * 기본 미지원이고, 크로미움 계열을 구글 키 없이 빌드하면 통째로 빠진다.
 * 그때 음성이 사라지는 대신 브라우저 안에서 도는 모델로 넘어간다.
 * <b>둘 다 안 되면 텍스트 검색이 그대로 남는다</b> — 음성은 보조 경로이지
 * 유일 경로가 아니다.
 *
 * <p>바꿔 달 자리는 이 배열 하나다. §12.2-C 비교에서 Whisper가 이기면 순서를 뒤집는다.
 * 그때 근거는 정확도가 되고, <b>발화가 기기를 떠나지 않는다</b>는 것(§11.4)이 덤으로
 * 따라온다 — 지금은 그 덤만 보고 순서를 정하지 않는다.
 *
 * <p>모델은 <b>마이크를 처음 누를 때</b> 받는다(`lazyTransformersEngine`). 첫 화면에
 * 얹으면 음성을 안 쓰는 사람까지 23MB를 받는다 — 이 프로젝트가 온디바이스를 주장해 온
 * 근거(§14 번들 크기)와 정면으로 부딪힌다.
 */
export interface SttOptions {
  /**
   * 어느 엔진을 앞에 둘 것인가. 기본은 `"web"`.
   *
   * <p>바꿀 수 있게 열어 둔 이유는 §12.2-C 때문이다. 두 엔진을 <b>같은 발화로 번갈아</b>
   * 태워 보지 않으면 어느 쪽이 고령 발화에 나은지 알 수 없는데, 크롬에서는 Web Speech가
   * 언제나 쓸 수 있어 예비 엔진이 영영 불리지 않는다 — <b>재려는 것을 재 볼 방법이
   * 없어진다.</b> 데모에서는 주소에 `?stt=whisper`를 붙여 뒤집는다.
   */
  prefer?: "web" | "whisper";
  onProgress?: (percent: number) => void;
}

export function makeStt({ prefer = "web", onProgress }: SttOptions = {}): SttProvider {
  const whisper = new WhisperSttProvider({
    engine: lazyTransformersEngine({
      // `pnpm --filter tools fetch:model`이 받아 둔 것을 먼저 본다. 없으면 CDN.
      localPath: "/models/",
      ...(onProgress ? { onProgress } : {}),
    }),
    recorder: new BrowserMicRecorder(),
  });
  const web = new WebSpeechSttProvider();

  return new FallbackSttProvider(prefer === "whisper" ? [whisper, web] : [web, whisper]);
}

/** 주소에서 엔진 선택을 읽는다. 없으면 기본값. */
export function sttPreferenceFromUrl(search: string): "web" | "whisper" {
  return new URLSearchParams(search).get("stt") === "whisper" ? "whisper" : "web";
}
