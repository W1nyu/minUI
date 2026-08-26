import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/**
 * **온보딩을 이미 마친 사용자로 시작한다** (F5, `MinUIShell`).
 *
 * <p>여기 있는 테스트가 재는 것은 <b>돌아온 사용자</b>다 — 탭 수 비교(§12.2),
 * 프리필, 두 모드가 같은 기능을 쓰는지. 첫 실행 온보딩 2문항을 그대로 통과시키면
 * 모든 시나리오에 탭이 두 번씩 더 붙어 그 비교가 망가진다. 온보딩 자체를 재는 것은
 * 별도의 일이다.
 */
beforeEach(() => {
  localStorage.setItem("minui.demo.onboarded", "1");
});

afterEach(() => {
  localStorage.clear();
  cleanup();
  document.documentElement.removeAttribute("data-minui-scale");
});
