import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";

/**
 * 어느 통장에서 나가는가.
 *
 * <p>전에는 물을 필요가 없었다 — 사용자가 한 사람이고 `accounts[0]`이 곧 답이었다.
 * 사람이 늘고 통장이 둘 이상이 되면 그 침묵이 <b>틀린 통장에서 돈이 나가는 것</b>이 된다.
 *
 * <p>그렇다고 모두에게 한 걸음을 더 물리지는 않는다. 통장이 하나뿐인 사람에게 고르는
 * 칸을 보이면 이 저장소가 줄이려는 바로 그 단계 수가 늘어난다.
 */

let keyCounter = 0;

function renderAs(userId: string) {
  const api = new MockBankApi({ userId });
  render(<App api={api} storageKey={`source-test-${keyCounter++}`} />);
  return api;
}

async function openTransfer() {
  await waitFor(() =>
    expect(screen.getByRole("group", { name: "화면 방식" })).toBeInTheDocument(),
  );
  await userEvent.click(await screen.findByRole("button", { name: /계좌 이체/ }));
  await screen.findByRole("button", { name: "내용 확인하기" });
}

describe("보내는 통장 고르기", () => {
  it("통장이 여럿이면 고를 수 있고, 처음에는 주거래 통장이 골라져 있다", async () => {
    renderAs("u-1");
    await openTransfer();

    const picker = screen.getByLabelText("보낼 통장");
    expect(picker).toHaveValue("acc-1");
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
  });

  /** 계좌가 하나뿐인 사람에게는 고르는 칸이 아예 안 생긴다 — 단계가 늘지 않는다. */
  it("통장이 하나뿐이면 고르는 칸이 안 생긴다", async () => {
    renderAs("u-4");
    await openTransfer();

    expect(screen.queryByLabelText("보낼 통장")).not.toBeInTheDocument();
  });

  it("고른 통장에서 돈이 나간다", async () => {
    const api = renderAs("u-1");
    await openTransfer();

    await userEvent.selectOptions(screen.getByLabelText("보낼 통장"), "acc-2");
    await userEvent.selectOptions(screen.getByLabelText("받는 분"), "acc-6");
    await userEvent.type(screen.getByLabelText("보낼 금액"), "30000");
    await userEvent.click(screen.getByRole("button", { name: "내용 확인하기" }));

    // 확인 화면이 **고른 통장**을 그대로 되읽어 준다.
    expect(screen.getByText("적금 통장")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /보내기/ }));

    await waitFor(async () => {
      const accounts = await api.listAccounts();
      expect(accounts.find((account) => account.id === "acc-2")?.balance).toBe(6_100_000 - 30_000);
      expect(accounts.find((account) => account.id === "acc-1")?.balance).toBe(1_243_500);
    });
  });
});

