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

/** 인식 결과 하나. */
export interface SttResult {
  text: string;
  /** 0..1. 구현체가 신뢰도를 주지 않으면 1로 채운다. */
  confidence: number;
}

export interface SttProvider {
  /** 이 환경에서 쓸 수 있는가. false면 호스트는 텍스트 검색만 노출한다. */
  readonly isSupported: boolean;

  start(): Promise<void>;
  stop(): void;

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
