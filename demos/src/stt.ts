import {
  BrowserMicRecorder,
  FallbackSttProvider,
  WebSpeechSttProvider,
  WhisperSttProvider,
  lazyTransformersEngine,
  type SttProvider,
} from "@minui/voice";

/**
 * 음성 엔진을 고르는 자리 — **Web Speech가 주, Whisper는 예비.**
 *
 * <p>Web Speech를 쓴다. 실제로 두 엔진을 번갈아 써 보고 정했다 — `whisper-base`는
 * 한국어에서 넉넉하지 않았다. 더 큰 모델이면 나아지겠지만 받는 양이 배로 늘고,
 * <b>예비로만 둘 엔진에 그 값을 치를 이유가 없다.</b>
 *
 * <p>Whisper는 <b>Web Speech가 아예 없는 자리</b>를 메운다 — 파이어폭스는 기본 미지원이고,
 * 크로미움 계열을 구글 키 없이 빌드하면 통째로 빠진다. 그때 음성이 사라지는 대신
 * 넘어간다. <b>둘 다 안 되면 텍스트 검색이 그대로 남는다</b> — 음성은 보조 경로이지
 * 유일 경로가 아니다.
 *
 * <p>모델은 <b>마이크를 처음 누를 때</b> 받는다(`lazyTransformersEngine`). 첫 화면에
 * 얹으면 음성을 안 쓰는 사람까지 23MB를 받는다 — 이 프로젝트가 온디바이스를 주장해 온
 * 근거(§14 번들 크기)와 정면으로 부딪힌다.
 */
export interface SttOptions {
  /**
   * 어느 엔진을 앞에 둘 것인가. 기본은 `"web"`.
   *
   * <p>바꿀 수 있게 열어 둔 이유는 <b>예비 경로를 시험하기 위해서</b>다. 크롬에서는
   * Web Speech가 언제나 쓸 수 있어 예비 엔진이 영영 불리지 않는다 — 그러면 정작
   * 필요한 날(파이어폭스 사용자가 마이크를 누른 날) 그것이 도는지 알 수 없다.
   * <b>한 번도 안 도는 예비 경로는 예비가 아니다.</b> 데모에서는 주소에
   * `?stt=whisper`를 붙여 뒤집는다.
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
