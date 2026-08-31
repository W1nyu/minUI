import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BankApp } from "./BankApp.js";
import { HttpBankApi } from "./api/httpApi.js";
import { SessionOpenBankingMockApi } from "./api/mockApi.js";
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
 * 계정계가 있으면 그쪽에, 없으면 브라우저 안의 목에 붙는다.
 *
 * <p>전에는 무조건 `HttpBankApi`였고 주석에 "목으로 <b>조용히</b> 내려가지 않는 것이
 * 의도다 — 무엇을 보고 있는지 모르는 데모가 제일 나쁘다"고 적혀 있었다. 그 취지는
 * 그대로 지킨다. 다만 **조용하지 않게** 내려간다 — 목으로 붙으면 화면 맨 위에 상시
 * 띠가 뜬다(`App`의 `demoData`). 크게 말하고 내려가는 것은 원 주석과 어긋나지 않는다.
 *
 * <p>이 분기가 필요한 이유: 배포한 데모에는 Spring Boot도 Postgres도 없다. 그런데
 * `MockBankApi`는 흉내가 아니라 <b>같은 `BankApi`의 완전한 구현</b>이다 — 잔액을 실제로
 * 깎고, 거래내역 맨 앞에 넣고, 멱등성 키까지 지킨다. 이체가 끝까지 도는 것을 보여 주는
 * 데는 이것으로 충분하다.
 *
 * <p>이제 <b>사람마다</b> 만든다. 어느 쪽으로 붙든 로그인한 사람의 통장만 보이고,
 * 원장은 하나를 나눠 본다 — 김순자가 보낸 돈이 박정호로 들어갔을 때 도착해 있어야 한다.
 */
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const apiFor = (userId: string) =>
  apiBaseUrl
    ? new HttpBankApi(apiBaseUrl, { userId, session: `demo-${userId}` })
    : new SessionOpenBankingMockApi({ userId });
// Both implementations are contest-only virtual ledgers; the local backend
// persists its test data while the static demo keeps it in this browser session.
const demoData = true;

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
      <BankApp apiFor={apiFor} demoData={demoData} {...(stt ? { stt } : {})} />
    </TaskRecorderProvider>
  </StrictMode>,
);
