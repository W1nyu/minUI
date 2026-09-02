import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";

/** 첫 화면에서 가상 이체 시연으로 가는 유일한 통로. */
function bankEntry() {
  return screen.getByRole("link", { name: "가상 이체 시연" });
}

describe("첫 화면 — 바깥 시연 도구", () => {
  it("가상 이체만 휴대폰 프레임 밖에 둔다", () => {
    render(<App />);

    const actions = screen.getByRole("navigation", { name: "시연 도구" });
    const phone = document.querySelector(".app")!;

    expect(within(actions).getByRole("link", { name: "가상 이체 시연" })).toBe(bankEntry());
    expect(screen.queryByRole("button", { name: "+다른 금융사 얹어 보기" })).not.toBeInTheDocument();
    const studioEntry = document.querySelector<HTMLButtonElement>("[data-demo-tool=studio]");
    expect(studioEntry).toBeTruthy();
    expect(studioEntry).toHaveProperty("hidden", true);
    expect(phone.contains(actions)).toBe(false);
    expect(actions.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("AI 검증기 진입은 보여 주지 않는다", () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: /AI가 못 하는 것/ })).not.toBeInTheDocument();
  });

  it("숨긴 Studio 진입 기능은 남겨 둔다", () => {
    render(<App />);

    const studioEntry = document.querySelector<HTMLButtonElement>("[data-demo-tool=studio]");
    expect(studioEntry).not.toBeNull();
    fireEvent.click(studioEntry!);

    expect(screen.getByRole("heading", { name: "MinUI Studio" })).toBeInTheDocument();
  });

  it("금융사 메뉴의 수집·이식 설명을 화면에 보이지 않는다", () => {
    render(<App />);

    expect(screen.queryByText(/수집본|이식 검증용|메뉴 체계를 그대로/)).not.toBeInTheDocument();
  });
});
