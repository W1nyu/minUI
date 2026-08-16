import { useEffect } from "react";
import type { ScriptedOverrideStt } from "./ScriptedOverrideStt.js";

declare global {
  interface Window {
    /** F9 프로토콜에서 진행자가 잡는 손잡이. `?stt=script`일 때만 있다. */
    minuiStt?: { next: (text: string) => void; clear: () => void };
  }
}

/**
 * 음성 덮어쓰기를 브라우저 콘솔에 노출한다.
 *
 * <p>`MetricsBridge`와 같은 이유로 화면에 아무것도 띄우지 않는다 — 참가자가 평소처럼
 * 앱을 쓰는 모습을 보는 것이 목적인데, 조작 장치가 화면에 있으면 그 자체가 행동을 바꾼다.
 *
 * <p>F9 진행 순서 (기획안 §12.10):
 * <pre>
 *   minuiStt.next("우리 딸한테 십삼만원 보내줘")   // "삼십만원"을 말하게 하기 직전
 *   ... 참가자가 마이크를 누르고 말한다 ...
 *   // 이체 화면의 금액 제안이 13만원으로 뜬다. 참가자가 그것을 잡아내는지 본다.
 * </pre>
 */
export function SttBridge({ stt }: { stt: ScriptedOverrideStt }) {
  useEffect(() => {
    window.minuiStt = { next: (text) => stt.next(text), clear: () => stt.clear() };
    return () => {
      delete window.minuiStt;
    };
  }, [stt]);

  return null;
}
