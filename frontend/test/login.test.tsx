import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { BankApp } from "../src/BankApp.js";
import { MockBankApi } from "../src/api/mockApi.js";

/**
 * 로그인과 사용자 전환.
 *
 * <p>이 데모가 여태 못 한 것은 **받는 쪽으로 서 보는 것**이었다. 로그인이 생기는 이유는
 * 보안이 아니라 그것이다 — 보낸 돈이 도착했는지 보려면 받은 사람의 자리에 서야 한다.
 *
 * <p><b>PIN은 인증이 아니다.</b> 여기서 재는 것도 '안전한가'가 아니라 '틀린 번호로는
 * 다른 사람 화면에 못 들어가는가'라는 시연의 일관성이다.
 */

let keyCounter = 0;

function renderBankApp() {
  return render(
    <BankApp
      apiFor={(userId) => new MockBankApi({ userId })}
      storageKeyPrefix={`login-test-${keyCounter++}`}
    />,
  );
}

/** 아무 여섯 자리나 누른다 — 무엇을 눌러도 들어간다. */
async function signIn(name: string, pin = "482913") {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  for (const digit of pin) {
    await userEvent.click(screen.getByRole("button", { name: `숫자 ${digit}` }));
  }
}

async function waitForHome() {
  await waitFor(() =>
    expect(screen.getByRole("group", { name: "화면 방식" })).toBeInTheDocument(),
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("로그인", () => {
  it("사람군별로 나눠 사용자를 보여 준다", async () => {
    renderBankApp();

    for (const group of ["고령", "중년", "청년", "상점"]) {
      expect(await screen.findByRole("heading", { name: group })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /김순자/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /박정호/ })).toBeInTheDocument();
  });

  /**
   * 없는 보장을 주장하지 않으려면, 시연용이라는 말이 화면에 있어야 한다.
   *
   * <p>문구가 "실제 인증이 아니며"에서 <b>"비밀번호를 확인하지 않으며"</b>로 바뀌었다.
   * 앞의 것은 참이지만 두루뭉술했고, 뒤의 것은 이 화면이 실제로 안 하는 일을 그대로
   * 말한다 — 무엇을 누르든 들어간다는 사실이 고지에 드러나야 한다.
   */
  it("비밀번호를 확인하지 않는다고 화면에 적어 둔다", async () => {
    renderBankApp();
    expect(await screen.findByText(/비밀번호를 확인하지 않으며/)).toBeInTheDocument();
  });

  it("번호를 다 누르면 그 사람 이름으로 들어간다", async () => {
    renderBankApp();
    await signIn("김순자");

    await waitForHome();
    // 인사말과 "누구로 보는 중" 배지 두 자리에 뜬다 — 둘 다 그 사람이어야 한다.
    expect(screen.getAllByText(/김순자/).length).toBeGreaterThan(0);
  });

  /*
   * **무엇을 눌러도 들어간다.** 키패드는 은행 앱의 모양을 보여 주는 시늉이라
   * 맞고 틀림이 없다. 서로 다른 숫자로 두 번 들어가 그것을 못박아 둔다 —
   * 누군가 비교를 되살리면 여기서 걸린다.
   */
  it("아무 번호나 눌러도 들어간다", async () => {
    renderBankApp();
    await signIn("김순자", "482913");
    await waitForHome();

    await userEvent.click(screen.getByRole("button", { name: "나가기" }));
    await signIn("김순자", "770051");
    await waitForHome();
  });

  /** 다만 여섯 자리를 세는 시늉은 남는다 — 실제 간편 로그인이 그렇게 생겼다. */
  it("여섯 자리를 다 누르기 전에는 들어가지 않는다", async () => {
    renderBankApp();
    await signIn("김순자", "48291");

    expect(screen.getByRole("group", { name: "간편 비밀번호 키패드" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "화면 방식" })).not.toBeInTheDocument();
  });

  it("다른 사람으로 들어가면 그 사람 계좌가 보인다", async () => {
    renderBankApp();
    await signIn("박정호");

    await waitForHome();
    /*
     * 잔액 카드에 뜨는 것이 **박정호의 주거래 통장** 잔액이어야 한다.
     * 김순자의 1,243,500원이 뜨면 원장이 사람을 안 따라간 것이다.
     */
    await waitFor(() => expect(screen.getByText("1,870,000원")).toBeInTheDocument());
    expect(screen.queryByText("1,243,500원")).not.toBeInTheDocument();
  });

  it("나가기를 누르면 로그인 화면으로 돌아온다", async () => {
    renderBankApp();
    await signIn("김순자");
    await waitForHome();

    await userEvent.click(screen.getByRole("button", { name: "나가기" }));

    expect(await screen.findByRole("heading", { name: "고령" })).toBeInTheDocument();
  });

  /*
   * 진행자용 빠른 전환 (F: 시연 진행).
   *
   * <p>나가기와 **다른 물건**이다. 나가기는 사용자가 쓰는 문이라 다시 들어올 때 번호를
   * 묻는 것이 맞고, 이쪽은 시연 진행자가 사람을 갈아 끼우는 자리라 묻지 않는다.
   * 시연 중 왕복이 잦은데 매번 여섯 자리를 누르면 그 시간이 전부 대본 밖의 시간이 된다.
   *
   * <p>PIN을 건너뛰어도 잃는 것이 없다 — 애초에 지키는 것이 없기 때문이다.
   */
  it("진행자는 번호 없이 다른 사람으로 바로 넘어간다", async () => {
    renderBankApp();
    await signIn("김순자");
    await waitForHome();

    await userEvent.selectOptions(
      screen.getByLabelText("진행자용 — 다른 사람으로 바로 보기"),
      "u-8",
    );

    // 번호를 묻지 않고 그대로 박정호의 화면이다.
    await waitFor(() => expect(screen.getByText("1,870,000원")).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "간편 비밀번호 키패드" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/박정호/).length).toBeGreaterThan(0);
  });

  /*
   * 개인화가 사람을 따라가는가.
   *
   * <p>`storageKey`가 사람마다 달라야 김순자가 배운 말과 홈 카드 배치가 박정호에게
   * 새지 않는다. 이것은 편의가 아니라 §11.1이 말한 경계다 — 한 기기를 나눠 쓰는
   * 상황에서 남의 개인화가 내 화면에 뜨면 그 자체가 정보 노출이다.
   */
  it("사람마다 저장소 자리가 다르다", async () => {
    const seen: string[] = [];
    render(
      <BankApp
        apiFor={(userId) => new MockBankApi({ userId })}
        storageKeyPrefix={`login-test-${keyCounter++}`}
        onStorageKey={(key) => seen.push(key)}
      />,
    );

    await signIn("김순자");
    await waitForHome();
    await userEvent.click(screen.getByRole("button", { name: "나가기" }));
    await signIn("박정호");
    await waitForHome();

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
