import { MockSttProvider } from "@minui/voice";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";

/**
 * **엔진이 수취인을 안 고른 것이 화면까지 살아 있는가.**
 *
 * <p>`pickFromList`는 애매하면 일부러 `null`을 준다. 그 함수의 doc이 이유를 못박아 뒀다 —
 * <b>"비어 있는 칸은 사용자가 채우면 되지만, 잘못 채워진 칸은 사용자가 알아채야만
 * 고쳐진다."</b> 목록에 없거나 두 이름이 비슷하면 고르지 않는 것이 설계다.
 *
 * <p>그런데 화면이 그 거절을 덮고 있었다. `payees[0]`으로 기본값을 채워서, 엔진이
 * "모르겠다"고 한 자리에 <b>맨 앞 수취인이 고른 것처럼</b> 들어가 있었다. 리허설에서
 * "삼촌한테 3만원 보내줘"라고 했더니 `행복아파트 관리사무소`가 골라져 있었다.
 *
 * <p>고령 사용자와 큰 `보내기` 버튼이 함께 있는 화면에서, 미리 골라진 남의 이름은
 * 이 기능이 할 수 있는 가장 나쁜 실수다(§9.3). 그래서 <b>못 고르면 비워 둔다.</b>
 */

/** `prefill.test.tsx`와 같은 길. 사용자가 실제로 밟는 경로여야 경계가 드러난다. */
async function openTransfer(utterance: string) {
  const stt = new MockSttProvider([{ text: utterance }]);
  render(
    <App
      api={new MockBankApi()}
      initialMode="minui"
      storageKey={`refusal-${Math.random()}`}
      stt={stt}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /잔액 보기/ })).toBeInTheDocument(),
  );

  await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
  await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

  const found = await screen.findByRole("region", { name: "찾은 메뉴" });
  await userEvent.click(within(found).getByRole("button", { name: /계좌 이체/ }));

  return screen.findByRole("dialog", { name: "계좌 이체" });
}

describe("수취인 — 못 고르면 비워 둔다", () => {
  it("들은 이름이 목록에 없으면 아무도 골라져 있지 않다 ★", async () => {
    const dialog = await openTransfer("박영희한테 송금");

    // 맨 앞 수취인이 아니라 빈 값이어야 한다.
    const select = within(dialog).getByLabelText("받는 분") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("비어 있으면 무엇을 해야 하는지 말해 준다", async () => {
    const dialog = await openTransfer("박영희한테 송금");

    const select = within(dialog).getByLabelText("받는 분");
    expect(within(select).getByRole("option", { name: /고르세요/ })).toBeInTheDocument();
  });

  it("비어 있는 채로 보내면 보내지 않고 이유를 말한다", async () => {
    const dialog = await openTransfer("박영희한테 송금");

    await userEvent.type(within(dialog).getByLabelText("보낼 금액"), "30000");
    await userEvent.click(within(dialog).getByRole("button", { name: "보내기" }));

    expect(await within(dialog).findByText(/받는 분을 선택/)).toBeInTheDocument();
    // 보냈다는 화면이 뜨면 안 된다.
    expect(within(dialog).queryByText(/보냈습니다/)).not.toBeInTheDocument();
  });

  it("들은 이름이 목록에 있으면 그 사람이 골라져 있다", async () => {
    const dialog = await openTransfer("김미영한테 송금");

    expect(within(dialog).getByLabelText("받는 분")).toHaveDisplayValue(/김미영/);
  });
});
