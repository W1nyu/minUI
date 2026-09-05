/**
 * 음성 인식 Provider 추상화 (기획안 §9.1).
 *
 * STT는 개발 단계에서 무료 수단으로 검증하고, 상용 도입 시 성능 좋은 엔진으로
 * 교체할 수 있어야 한다. 교체 시 바뀌는 코드는 구현체 파일 하나이며,
 * `SearchPipeline` 이상의 상위 코드는 STT가 무엇인지 모른다.
 *
 *   개발·데모   브라우저 Web Speech API        비용 0
 *   로컬 검증   whisper.cpp 계열 로컬 모델      비용 0
 *   상용 전환   상용 STT API (국내 벤더)        유료
 */

export type SttErrorCode =
  /** 마이크 권한이 없다 */
  | "permission-denied"
  /** 이 환경에서 음성 인식을 쓸 수 없다 */
  | "not-supported"
  /** 아무 말도 들리지 않았다 */
  | "no-speech"
  /** 네트워크가 필요한 구현체에서 연결이 끊겼다 */
  | "network"
  /** 그 밖의 실패 */
  | "unknown";

export interface SttError {
  code: SttErrorCode;
  message: string;
}

/** 엔진이 들은 것 하나. 순위가 있는 대안 목록의 한 칸이기도 하다. */
export interface SttHypothesis {
  text: string;
  /** 0..1. 구현체가 신뢰도를 주지 않으면 1로 채운다. */
  confidence: number;
}

/** 인식 결과 하나. */
export interface SttResult extends SttHypothesis {
  /**
   * 이 인식이 기기 안에서 돌았는가 (M22).
   *
   * <p>모르는 구현체는 주지 않는다. 벤치가 온디바이스와 클라우드를 갈라 보는 데 쓴다 —
   * 둘은 다른 모델이므로 수치를 섞으면 안 된다.
   */
  local?: boolean;
  /**
   * 같은 발화에 대한 <b>다른 후보들</b>. 점수가 높은 것부터. (M21)
   *
   * <p>엔진이 들은 것을 하나로 확정하지 못할 때 여러 개를 준다. 첫 칸은 `text`와 같다.
   * 지금까지 이 값을 받지 않고 1순위만 썼는데, 버린 것 안에 정답이 있는 경우가
   * <b>공짜로 얻을 수 있는 회수</b>다 (기획안 §9.2).
   *
   * <p><b>선택 필드다.</b> 주지 않는 구현체가 있어도 부르는 쪽은 지금까지처럼 돈다.
   */
  alternatives?: readonly SttHypothesis[];
}

/** 인식기에 미리 알려 줄 말 하나 (M22). `boost`는 0..10 — 브라우저가 강제하는 범위다. */
export interface SttPhrase {
  phrase: string;
  boost: number;
}

export interface SttProvider {
  /** 이 환경에서 쓸 수 있는가. false면 호스트는 텍스트 검색만 노출한다. */
  readonly isSupported: boolean;

  start(): Promise<void>;
  stop(): void;

  /**
   * 이번 발화에서 나올 법한 말을 인식기에 미리 알려 준다 (M22). **선택 계약이다.**
   *
   * <p>M21이 되찾지 못한 오류는 발음 변이가 아니라 어휘 치환이었다 —
   * `자동이체`→`자동차`, `돈 부쳐야 하는데`→`동두천`. 인식기가 자기가 은행 앱에서 듣고
   * 있다는 걸 모르기 때문이고, 그것은 검색이 사후에 고칠 수 있는 종류가 아니다.
   *
   * <p>지원하지 않는 구현체에는 <b>없다.</b> 부르는 쪽은 `stt.setPhrases?.(...)`로 부르고,
   * 없으면 지금까지처럼 돈다(불변 규칙 9).
   */
  setPhrases?(phrases: readonly SttPhrase[]): void;

  /**
   * 오디오가 기기를 떠나지 않는 인식을 <b>쓸 수 있으면</b> 쓴다 (M22). **선택 계약이다.**
   *
   * <p>강요가 아니라 요청이다 — 언어팩이 없으면 내려받게 하지 않고 조용히 지금까지의
   * 경로로 돈다. 어느 쪽으로 돌았는지는 `SttResult.local`이 말한다.
   */
  preferLocal?(value: boolean): void;

  /** 중간 인식 결과. 응답 체감 속도를 높이는 데 쓴다 (기획안 §9.2). */
  onPartial(callback: (text: string) => void): () => void;
  onFinal(callback: (result: SttResult) => void): () => void;
  onError(callback: (error: SttError) => void): () => void;
}

/** 구독 해제 함수를 돌려주는 최소 이벤트 버스. 구현체들이 공유한다. */
export class Listeners<T> {
  #callbacks = new Set<(value: T) => void>();

  add(callback: (value: T) => void): () => void {
    this.#callbacks.add(callback);
    return () => {
      this.#callbacks.delete(callback);
    };
  }

  emit(value: T): void {
    for (const callback of [...this.#callbacks]) callback(value);
  }

  clear(): void {
    this.#callbacks.clear();
  }
}
