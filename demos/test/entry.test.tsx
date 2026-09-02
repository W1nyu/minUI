import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";

/** 첫 화면에서 가상 이체 시연으로 가는 유일한 통로. */
function bankEntry() {
  return screen.getByRole("link", { name: "가상 이체 시연" });
}

describe("첫 화면 — 가상 이체 시연", () => {
  it("버튼 하나만 맨 위에 둔다", () => {
    render(<App />);

    expect(bankEntry()).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "가상 이체 시연" })).toHaveLength(1);

    const siteSwitch = screen.getByRole("navigation", { name: "이식 대상" });
    const order = bankEntry().compareDocumentPosition(siteSwitch);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("설명 배너 없이 바로 시연으로 들어간다", () => {
    render(<App />);

    expect(screen.queryByText("공모전 시연")).not.toBeInTheDocument();
    expect(screen.queryByText(/말로 찾고|테스트 계좌와|이식 데모|기기 안에서/)).not.toBeInTheDocument();
  });

  it("배포 기준 경로로 이동한다", () => {
    render(<App />);

    // vite의 base가 "/"인 테스트에서는 "/bank/"다. Pages에서는 "/minUI/bank/"가 된다.
    expect(bankEntry()).toHaveAttribute("href", `${import.meta.env.BASE_URL}bank/`);
  });
});
