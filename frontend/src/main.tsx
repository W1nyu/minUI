import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { HttpBankApi } from "./api/httpApi.js";

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

createRoot(container).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
