import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { MockBankApi } from "../src/api/mockApi.js";

/**
 * 도착한 뒤에도 길이 이어지는가 (M12 — 다음 단계 안내).
 *
 * <p>고령 사용자가 막히는 자리는 둘인데, 이 앱은 오랫동안 앞의 하나만 풀었다.
 * 카드와 음성이 <b>화면까지</b> 데려다주지만, 도착한 뒤에는 옆에 무엇이 있는지 알 길이
 * 없어 돌아가려면 전체 메뉴를 다시 열어야 했다.
 *
 * <p>여기서 재는 것은 세 가지다 — 이어지는가, <b>지어내지 않는가</b>, 그리고
 * 두 모드가 같은 것을 받는가(§12.2 변수 통제).
 */

async function openFrom(mode: "minui" | "classic", menuLabel: RegExp) {
  render(
    <App api={new MockBankApi()} initialMode={mode} storageKey={`m12-${Math.random()}`} />,
  );
  const user = userEvent.setup();

  if (mode === "minui") {
    await user.click(await screen.findByRole("button", { name: /전체 메뉴/ }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: menuLabel }));
  } else {
    // 기본 UI는 시트가 아니라 메뉴 트리다 (`scenarios.test.tsx`의 s3Classic과 같은 길).
    await user.click(await screen.findByRole("button", { name: "전체" }));
    const all = await screen.findByRole("region", { name: "전체 메뉴" });
    await user.click(within(all).getByRole("button", { name: /^이체$/ }));
    await user.click(within(all).getByRole("button", { name: menuLabel }));
  }
  return { user, dialog: await screen.findByRole("dialog") };
}

describe("이어서 할 수 있는 것", () => {
  it("계좌 이체 화면에서 같은 갈래의 형제를 보여 준다", async () => {
    const { dialog } = await openFrom("minui", /^계좌 이체$/);

    const nav = within(dialog).getByRole("navigation", { name: /이어서 하실 수 있어요/ });
    // `이체 › 보내기`의 형제는 `최근 보낸 곳` 하나다.
    expect(within(nav).getByRole("button", { name: /최근 보낸 곳/ })).toBeInTheDocument();
  });

  it("누르면 그 화면으로 이어진다", async () => {
    const { user, dialog } = await openFrom("minui", /^계좌 이체$/);

    const nav = within(dialog).getByRole("navigation", { name: /이어서 하실 수 있어요/ });
    await user.click(within(nav).getByRole("button", { name: /최근 보낸 곳/ }));

    expect(await screen.findByRole("dialog", { name: "최근 보낸 곳" })).toBeInTheDocument();
  });

  it("확인이 필요한 것은 색이 아니라 글자로 알린다", async () => {
    const { dialog } = await openFrom("minui", /^계좌 이체$/);

    const nav = within(dialog).getByRole("navigation", { name: /이어서 하실 수 있어요/ });
    // `최근 보낸 곳`은 high다. 색만으로 알리면 색을 못 보는 사람에게는 안 알린 것이다.
    expect(within(nav).getByText("눌러서 확인")).toBeInTheDocument();
  });

  it("자기 자신은 다음 단계에 없다", async () => {
    const { dialog } = await openFrom("minui", /^계좌 이체$/);

    const nav = within(dialog).getByRole("navigation", { name: /이어서 하실 수 있어요/ });
    expect(within(nav).queryByRole("button", { name: /^계좌 이체$/ })).not.toBeInTheDocument();
  });

  it("두 모드가 같은 다음 단계를 받는다 ★", async () => {
    const easy = await openFrom("minui", /^계좌 이체$/);
    const easyNav = within(easy.dialog).getByRole("navigation", {
      name: /이어서 하실 수 있어요/,
    });
    const easyLabels = within(easyNav)
      .getAllByRole("button")
      .map((button) => button.textContent);

    // 두 번째 앱을 띄우기 전에 앞의 것을 걷는다. 안 그러면 다이얼로그가 둘이 된다.
    cleanup();

    const classic = await openFrom("classic", /^계좌 이체$/);
    const classicNav = within(classic.dialog).getByRole("navigation", {
      name: /이어서 하실 수 있어요/,
    });
    const classicLabels = within(classicNav)
      .getAllByRole("button")
      .map((button) => button.textContent);

    /*
     * 두 모드가 같은 화면 컴포넌트를 연다(§12.2). 다음 단계가 한쪽에만 있으면
     * 완료 시간 차이가 UI 때문인지 이 기능 때문인지 말할 수 없게 된다.
     */
    expect(easyLabels).toEqual(classicLabels);
  });
});
