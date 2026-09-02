import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";

let key = 0;

describe("공개 시연 상단", () => {
  it("가상 원장 초기화와 이전 화면 버튼을 프레임 밖 도구로 둔다", async () => {
    const reset = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <App
        api={new MockBankApi()}
        demoData
        resetDemoLedger={reset}
        storageKey={`demo-chrome-${key++}`}
      />,
    );

    const notice = await screen.findByRole("complementary", { name: "가상 오픈뱅킹 시연" });
    expect(within(notice).getByRole("button", { name: "가상 원장 초기화" })).toBeInTheDocument();
    expect(within(notice).getAllByRole("button")).toHaveLength(1);
    expect(within(notice).queryByText(/테스트 계좌|실제 계좌|마이데이터/)).not.toBeInTheDocument();

    const back = screen.getByRole("link", { name: /이전 화면/ });
    expect(back).toHaveAttribute("href", "../");
    expect(back).toHaveAttribute("data-demo-chrome", "true");

    await userEvent.click(within(notice).getByRole("button", { name: "가상 원장 초기화" }));
    expect(confirm).toHaveBeenCalledWith("가상 원장을 초기화할까요?");
    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
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
  });
});
