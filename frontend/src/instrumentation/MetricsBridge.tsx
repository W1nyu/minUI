import { useEffect } from "react";
import { useTaskRecorder, type RecorderValue } from "./TaskRecorder.js";

declare global {
  interface Window {
    /** 사용자 테스트 진행자가 개발자 도구에서 잡는 손잡이. */
    minuiMetrics?: RecorderValue;
  }
}

/**
 * 계측기를 브라우저 콘솔에 노출한다.
 *
 * <p>화면에 측정 패널을 띄우지 않는 것이 의도다. 기획안 §12.2-B의 테스트는 참가자가
 * 평소처럼 앱을 쓰는 모습을 보는 것인데, 화면에 초시계와 카운터가 붙어 있으면 그 자체가
 * 행동을 바꾼다. 진행자만 보이지 않는 곳에서 조작한다.
 *
 * <p>진행 순서:
 * <pre>
 *   minuiMetrics.begin("S1", "transfer.account", "minui")   // 과제 지시 직후
 *   ... 참가자가 수행 ...                                      // 완료는 자동 감지
 *   copy(minuiMetrics.toJSON())                             // 세션 끝나고 회수
 * </pre>
 */
export function MetricsBridge() {
  const recorder = useTaskRecorder();

  useEffect(() => {
    window.minuiMetrics = recorder;
    return () => {
      delete window.minuiMetrics;
    };
  }, [recorder]);

  return null;
}
