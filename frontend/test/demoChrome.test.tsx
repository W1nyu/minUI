import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";

let key = 0;

describe("공개 시연 상단", () => {
  it("가상 원장 초기화와 이전 화면을 접을 수 있는 시연 도구에 둔다", async () => {
    const reset = vi.fn();
    const exit = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <App
        api={new MockBankApi()}
        demoData
        resetDemoLedger={reset}
        onExit={exit}
        storageKey={`demo-chrome-${key++}`}
      />,
    );

    const actions = await screen.findByRole("navigation", { name: "시연 도구" });
    expect(document.querySelector(".app-bar")?.contains(actions)).toBe(true);
    const toggle = within(actions).getByRole("button", { name: "시연 도구 열기" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(actions).getByRole("button", { name: "가상 원장 초기화" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "계정 로그아웃" })).toBeInTheDocument();
    expect(within(actions).queryByText(/테스트 계좌|실제 계좌|마이데이터/)).not.toBeInTheDocument();
    expect(screen.queryByText(/님으로 보는 중|다른 사람으로 바로 보기/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /연습해 보기|연습 끝내기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /AI 도우미 끄고 보기|다시 켜기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 화면에 의견 남기기" })).not.toBeInTheDocument();

    const back = within(actions).getByRole("link", { name: "가상 이체 나가기" });
    expect(back).toHaveAttribute("href", "../");
    expect(back).toHaveAttribute("data-demo-chrome", "true");

    await userEvent.click(within(actions).getByRole("button", { name: "가상 원장 초기화" }));
    expect(confirm).toHaveBeenCalledWith("가상 원장을 초기화할까요?");
    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    await userEvent.click(within(actions).getByRole("button", { name: "계정 로그아웃" }));
    expect(exit).toHaveBeenCalledOnce();
  });
});

describe("화면 도움", () => {
  it("하나의 고정 화면을 쓴다", async () => {
    render(<App api={new MockBankApi()} storageKey={`adaptive-copy-${key++}`} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /잔액 보기/ })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("region", { name: /화면 도움/ })).not.toBeInTheDocument();
    expect(document.querySelector('.minui-root[data-support-level="standard"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "홈 카드 고르기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "왜 이렇게 보이나요?" })).not.toBeInTheDocument();
  });
});
