import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  AdaptiveSupportProvider,
  DEFAULT_ADAPTIVE_SUPPORT_CONFIG,
  useAdaptiveSupport,
} from "../src/adaptation/AdaptiveSupport.js";

function Probe() {
  const support = useAdaptiveSupport();
  return (
    <>
      <output>
        {`${support.asked}/${support.consented}/${support.level}/${support.signals.interactions}/${support.signals.quickBacktracks}`}
      </output>
      <button type="button" onClick={support.grantConsent}>
        동의
      </button>
      <button type="button" onClick={() => support.recordPress(1_000)}>
        느린 누름
      </button>
      <button type="button" onClick={() => support.recordMenuOpened("this-menu-name-must-not-be-stored")}>
        화면 열기
      </button>
      <button type="button" onClick={() => support.recordMenuClosed("this-menu-name-must-not-be-stored")}>
        바로 돌아감
      </button>
      <button type="button" onClick={support.forget}>
        지우기
      </button>
    </>
  );
}

describe("기기 안 적응형 화면", () => {
  it("동의 전에는 기록하지 않고, 동의 뒤에도 집계만 남긴다", async () => {
    const storageKey = `adaptive-${Math.random()}`;
    render(
      <AdaptiveSupportProvider
        storageKey={storageKey}
        config={{ ...DEFAULT_ADAPTIVE_SUPPORT_CONFIG, minSignalsBeforeChange: 2, simpleAtOrAbove: 0.3 }}
      >
        <Probe />
      </AdaptiveSupportProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "느린 누름" }));
    expect(screen.getByText("false/false/guided/0/0")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "동의" }));
    await userEvent.click(screen.getByRole("button", { name: "느린 누름" }));
    await userEvent.click(screen.getByRole("button", { name: "느린 누름" }));
    expect(screen.getByText("true/true/simple/2/0")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "화면 열기" }));
    await userEvent.click(screen.getByRole("button", { name: "바로 돌아감" }));
    const raw = sessionStorage.getItem(`${storageKey}:adaptive-support:v1`);
    expect(raw).not.toContain("this-menu-name-must-not-be-stored");
    expect(raw).toContain("quickBacktracks");

    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(sessionStorage.getItem(`${storageKey}:adaptive-support:v1`)).toBeNull();
  });
});
