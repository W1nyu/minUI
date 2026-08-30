import { MockSttProvider } from "@minui/voice";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";

/**
 * 말한 순서대로 폼이 받아들인다 (M9, 기획안 §9.3).
 *
 * <p>여기서 재는 것은 편의가 아니라 <b>경계</b>다. 음성이 화면까지 데려다주고 수취인을
 * 골라 두는 것은 §9.3이 허용했지만, 금액이 채워지고 이체가 실행되는 것은 막았다.
 * 그 선이 실제로 어디에 그어져 있는지는 이 경로를 끝까지 밟아 봐야 보인다.
 *
 * <p>단위 테스트로는 부족하다 — 엔진이 프리필을 실어 보내도 화면이 그것을 금액 칸에
 * 넣어 버리면 경계가 뚫리는데, 그것은 두 패키지 사이에서만 드러난다.
 */

function boot(utterance: string) {
  const stt = new MockSttProvider([{ text: utterance }]);
  render(
    <App api={new MockBankApi()} initialMode="minui" storageKey={`m9-${Math.random()}`} stt={stt} />,
  );
  return waitFor(() =>
    expect(screen.getByRole("button", { name: /잔액 보기/ })).toBeInTheDocument(),
  );
}

/** 말로 찾기 → 후보 → 이체 화면. 사용자가 실제로 밟는 길. */
async function speakAndOpenTransfer() {
  await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
  await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

  const found = await screen.findByRole("region", { name: "찾은 메뉴" });
  await userEvent.click(within(found).getByRole("button", { name: /계좌 이체/ }));

  return screen.findByRole("dialog", { name: "계좌 이체" });
}

describe("수취인은 미리 골라 둔다", () => {
  it("말한 사람이 골라져 있고, 골랐다는 것을 알린다", async () => {
    await boot("김미영한테 3만원 송금");
    const dialog = await speakAndOpenTransfer();

    expect(within(dialog).getByLabelText("받는 분")).toHaveDisplayValue(
      /김미영/,
    );
    // 조용히 골라 두면 사용자는 그것이 자기 말 때문인지 모른다 (M8과 같은 판단).
    expect(within(dialog).getByRole("status")).toHaveTextContent(/김미영/);
  });

  it("어순이 달라도 같다", async () => {
    await boot("3만원 김미영한테 송금");
    const dialog = await speakAndOpenTransfer();

    expect(within(dialog).getByLabelText("받는 분")).toHaveDisplayValue(/김미영/);
  });

  it("긴 이름은 한 낱말로 불러도 골라진다", async () => {
    await boot("관리사무소에 송금");
    const dialog = await speakAndOpenTransfer();

    expect(within(dialog).getByLabelText("받는 분")).toHaveDisplayValue(
      /관리사무소/,
    );
  });

  it("목록에 없는 이름을 말하면 아무도 고르지 않는다", async () => {
    await boot("박영희한테 송금");
    const dialog = await speakAndOpenTransfer();

    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
  });
});

/**
 * **이 절이 M9의 안전 경계다.**
 *
 * <p>§9.3은 "금액 확정"을 음성으로 불가한 쪽에 뒀고, §7.4의 시퀀스도 "수취인 프리필,
 * 금액 미입력"이라고 못박았다. 들은 금액을 버리지는 않되 <b>채우지도 않는다.</b>
 */
describe("금액은 채우지 않고 제안한다 ★", () => {
  it("말한 금액이 금액 칸에 들어가 있지 않다", async () => {
    await boot("김미영한테 3만원 송금");
    const dialog = await speakAndOpenTransfer();

    expect(within(dialog).getByLabelText("보낼 금액")).toHaveValue("");
  });

  it("대신 눌러서 넣을 수 있게 보여 준다", async () => {
    await boot("김미영한테 3만원 송금");
    const dialog = await speakAndOpenTransfer();

    const suggestion = within(dialog).getByRole("button", { name: /30,000원.*들었어요/ });
    await userEvent.click(suggestion);

    expect(within(dialog).getByLabelText("보낼 금액")).toHaveValue("30000");
  });

  it("한글로 말한 금액도 제안한다", async () => {
    await boot("김미영한테 삼십만원 송금");
    const dialog = await speakAndOpenTransfer();

    expect(
      within(dialog).getByRole("button", { name: /300,000원.*들었어요/ }),
    ).toBeInTheDocument();
  });

  it("금액을 말하지 않았으면 제안도 없다", async () => {
    await boot("김미영한테 송금");
    const dialog = await speakAndOpenTransfer();

    expect(within(dialog).queryByRole("button", { name: /들었어요/ })).not.toBeInTheDocument();
  });
});

/**
 * 프리필이 붙었다고 화면이 저절로 열리면, "엄마한테 보내줘" 한마디로 수취인이 채워진
 * 이체 화면이 뜬다. §9.3이 막는 것이 정확히 그 경로다.
 */
describe("음성만으로는 이체 화면이 저절로 열리지 않는다 ★", () => {
  it("반드시 후보를 한 번 눌러야 한다", async () => {
    await boot("김미영한테 3만원 송금");

    await userEvent.click(screen.getByRole("button", { name: /말로 찾기/ }));
    await userEvent.click(screen.getByRole("button", { name: /눌러서 말하기/ }));

    await screen.findByRole("region", { name: "찾은 메뉴" });
    expect(screen.queryByRole("dialog", { name: "계좌 이체" })).not.toBeInTheDocument();
  });

  it("이체는 여전히 사람이 확정한다", async () => {
    await boot("김미영한테 3만원 송금");
    const dialog = await speakAndOpenTransfer();

    // 수취인이 골라져 있고 금액 제안까지 눌러도, 보내기를 누르기 전에는 아무 일도 없다.
    await userEvent.click(within(dialog).getByRole("button", { name: /들었어요/ }));
    expect(within(dialog).queryByText(/보냈습니다/)).not.toBeInTheDocument();

    /*
     * 확인 화면을 지나야 보내진다. **읽는 자리와 누르는 자리가 갈라져 있다** —
     * 내용 확인을 눌러도 아직 원장은 그대로이고, 수취 정보를 확인했다고 표시하기
     * 전에는 마지막 버튼이 눌리지도 않는다.
     */
    await userEvent.click(within(dialog).getByRole("button", { name: "내용 확인하기" }));
    expect(within(dialog).queryByText(/보냈습니다/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "네, 확인하고 보내기" }),
    ).toBeDisabled();

    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("button", { name: "네, 확인하고 보내기" }));
    expect(await within(dialog).findByText(/보냈습니다/)).toBeInTheDocument();
  });
});
