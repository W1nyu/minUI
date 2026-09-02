import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";

let key = 0;

describe("공개 시연 상단", () => {
  it("가상 원장 초기화 버튼만 보여 준다", async () => {
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

    await userEvent.click(within(notice).getByRole("button", { name: "가상 원장 초기화" }));
    expect(confirm).toHaveBeenCalledWith("가상 원장을 초기화할까요?");
    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
  });
});

describe("화면 도움 설정", () => {
  it("짧은 질문과 네·아니오만 먼저 보여 준다", async () => {
    render(<App api={new MockBankApi()} storageKey={`adaptive-copy-${key++}`} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "네" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "아니오" })).toBeInTheDocument();
    expect(screen.getByText("이 탭의 사용 기록으로 화면을 맞출까요?")).toBeInTheDocument();
    expect(screen.queryByText(/누름 시간|되돌아감|말하기 대기/)).not.toBeInTheDocument();
  });
});
