import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";

/**
 * **공개 데모의 첫 화면**이 심사자를 어디로 보내는가.
 *
 * <p>루트(`/minUI/`)는 실제 금융사 이식 데모부터 보여 준다. 그런데 이 프로젝트의 핵심 —
 * <b>말로 찾아 → 사람이 확인 → 가상 잔액이 바뀐다</b> — 는 미니은행(`/minUI/bank/`)에만
 * 있고, 전에는 그리로 가는 통로가 <b>화면 맨 아래 작은 링크</b> 하나뿐이었다.
 * 스크롤하지 않은 심사자는 이식 데모만 보고 나간다.
 *
 * <p>문구도 틀려 있었다. 그 링크는 "미니은행에서 <b>실제로</b> 이체해 보기"라고 적혀 있었는데,
 * 이 데모에서 움직이는 것은 <b>가상 원장</b>이다. 시연의 범위를 잘못 전달하는 문구가
 * 첫 화면에 있으면 뒤에 붙인 모든 고지가 무색해진다.
 *
 * <p>여기서 재는 것은 세 가지다 — 스크롤 없이 갈 수 있는가, 문구가 정직한가,
 * 그리고 <b>배포 기준 경로가 붙는가</b>(GitHub Pages는 `/minUI/` 아래에 있다).
 */

/** 첫 화면에서 미니은행으로 가는 통로. */
function bankEntry() {
  return screen.getByRole("link", { name: /가상 이체 시연/ });
}

describe("첫 화면 — 한 번의 선택으로 시연에 들어간다", () => {
  it("미니은행으로 가는 통로가 첫 화면에 있다", () => {
    render(<App />);
    expect(bankEntry()).toBeInTheDocument();
  });

  it("이식 데모보다 **앞에** 있다 — 스크롤하지 않아도 보인다 ★", () => {
    render(<App />);

    const entry = bankEntry();
    const siteSwitch = screen.getByRole("navigation", { name: "이식 대상" });

    /*
     * DOM 순서로 잰다. 화면 위치를 jsdom에서 잴 수는 없지만, 순서가 뒤면
     * 어떤 스타일을 줘도 스크롤 아래로 밀린다.
     */
    const order = entry.compareDocumentPosition(siteSwitch);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("배포 기준 경로가 붙는다", () => {
    render(<App />);
    // vite의 base가 "/"인 테스트에서는 "/bank/"다. Pages에서는 "/minUI/bank/"가 된다.
    expect(bankEntry()).toHaveAttribute("href", `${import.meta.env.BASE_URL}bank/`);
  });
});

describe("문구 — 가상이라고 말한다", () => {
  it("통로 문구에 '실제'가 들어가지 않는다 ★", () => {
    render(<App />);
    expect(bankEntry().textContent ?? "").not.toMatch(/실제/);
  });

  it("들어가기 전에 안전 경계가 보인다 ★", () => {
    render(<App />);

    const banner = screen.getByRole("region", { name: /공모전 시연/ });
    const text = banner.textContent ?? "";

    // 가상 원장이라는 것과, 실제 계좌·송금이 아니라는 것 둘 다.
    expect(text).toMatch(/가상/);
    expect(text).toMatch(/실제 계좌|마이데이터/);
  });

  it("사람이 마지막에 확인한다는 것을 미리 말한다", () => {
    render(<App />);
    const banner = screen.getByRole("region", { name: /공모전 시연/ });
    expect(banner.textContent ?? "").toMatch(/확인/);
  });
});

describe("무엇이 도는지 미리 말한다", () => {
  it("기기 안에서 돈다는 것을 첫 화면에서 알린다 ★", () => {
    render(<App />);
    const banner = screen.getByRole("region", { name: /공모전 시연/ });

    /*
     * 공개 배포에는 원격 도우미도 원격 의미 검색도 없다. 없는 것이 고장으로 보이지 않게
     * 만들어 두긴 했지만, 무엇이 도는지 모르는 채로 쓰는 것과 알고 쓰는 것은 다르다.
     */
    expect(within(banner).getByText(/기기 안에서/)).toBeInTheDocument();
  });

  it("못 찾으면 되묻기로 이어진다고 말한다 — 빈 기능이 아니다", () => {
    render(<App />);
    const banner = screen.getByRole("region", { name: /공모전 시연/ });
    expect(banner.textContent ?? "").toMatch(/되묻기/);
  });
});

describe("두 데모의 목적이 갈라져 있다", () => {
  it("아래쪽이 이식 데모라는 것을 말한다", () => {
    render(<App />);
    const banner = screen.getByRole("region", { name: /공모전 시연/ });
    // 이식 데모는 도착 화면이 스텁이다. 그것을 모르면 "미완성"으로 읽힌다.
    expect(within(banner).getByText(/이식/)).toBeInTheDocument();
  });
});
