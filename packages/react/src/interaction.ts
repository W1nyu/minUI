/**
 * 호스트가 선택적으로 받을 수 있는, 원문·대상 이름이 없는 화면 상호작용 요약.
 *
 * <p>이 값은 MinUI가 저장하거나 전송하지 않는다. 접근성 실험처럼 호스트가 명시적으로
 * 연결했을 때만 기기 안에서 사용할 수 있는 관찰 지점이다.
 */
export type MinUIInteraction =
  | { kind: "press"; durationMs?: number }
  | { kind: "voice"; durationMs: number };
