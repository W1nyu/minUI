import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { HttpBankApi } from "./api/httpApi.js";
import { MetricsBridge } from "./instrumentation/MetricsBridge.js";
import { ScriptedOverrideStt } from "./instrumentation/ScriptedOverrideStt.js";
import { SttBridge } from "./instrumentation/SttBridge.js";
import { TaskRecorderProvider } from "./instrumentation/TaskRecorder.js";
import { makeStt } from "./stt.js";

import "@minui/react/tokens.css";
import "@minui/react/minui.css";
import "./app.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root를 찾을 수 없습니다.");

/**
 * 실행 중인 데모는 실제 Spring Boot 백엔드에 붙는다 (M1).
 * `backend/`를 띄우지 않으면 화면이 빈 상태로 뜬다 — 목으로 조용히 내려가지 않는 것이
 * 의도다. 무엇을 보고 있는지 모르는 데모가 제일 나쁘다.
 */
const api = new HttpBankApi(
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080",
);

/**
 * `?stt=script`일 때만 음성 덮어쓰기를 끼운다 (F9 프로토콜, 기획안 §12.10).
 *
 * 플래그가 없으면 `null`이고, 그러면 `MinUIShell`이 지금까지처럼 스스로 `makeStt()`를
 * 만든다 — 이 파일이 기본 경로에 손대지 않는다는 뜻이다.
 */
const scripted = new URLSearchParams(window.location.search).get("stt") === "script";
const stt = scripted ? new ScriptedOverrideStt(makeStt()) : null;

createRoot(container).render(
  <StrictMode>
    {/*
      계측을 실제 실행에서도 켜 둔다. 화면에는 아무것도 나타나지 않고,
      사용자 테스트 진행자가 콘솔의 `minuiMetrics`로 과제를 여닫는다 (기획안 §12.2-A).
    */}
    <TaskRecorderProvider>
      <MetricsBridge />
      {stt && <SttBridge stt={stt} />}
      <App api={api} {...(stt ? { stt } : {})} />
    </TaskRecorderProvider>
  </StrictMode>,
);
