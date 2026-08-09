import { describe, expect, it, vi } from "vitest";
import { MockSttProvider } from "../src/MockSttProvider.js";
import { WebSpeechSttProvider } from "../src/WebSpeechSttProvider.js";
import type { SttResult } from "../src/SttProvider.js";

describe("MockSttProvider", () => {
  it("스크립트된 발화를 최종 결과로 낸다", async () => {
    const provider = new MockSttProvider([{ text: "돈 보내기" }]);
    const results: SttResult[] = [];
    provider.onFinal((r) => results.push(r));

    await provider.start();

    expect(results).toEqual([{ text: "돈 보내기", confidence: 1 }]);
  });

  it("중간 결과를 먼저 흘린다 (기획안 §9.2)", async () => {
    const provider = new MockSttProvider([
      { partials: ["돈", "돈 보"], text: "돈 보내기" },
    ]);
    const partials: string[] = [];
    provider.onPartial((t) => partials.push(t));

    await provider.start();

    expect(partials).toEqual(["돈", "돈 보"]);
  });

  it("낮은 신뢰도를 그대로 전달한다 — 판단은 상위가 한다", async () => {
    const provider = new MockSttProvider([{ text: "이제", confidence: 0.3 }]);
    const results: SttResult[] = [];
    provider.onFinal((r) => results.push(r));

    await provider.start();

    expect(results[0]!.confidence).toBe(0.3);
  });

  it("오류도 재생한다", async () => {
    const provider = new MockSttProvider([
      { text: "", error: { code: "permission-denied", message: "마이크 거부" } },
    ]);
    const errors: string[] = [];
    provider.onError((e) => errors.push(e.code));

    await provider.start();

    expect(errors).toEqual(["permission-denied"]);
  });

  it("발화가 떨어지면 no-speech를 낸다", async () => {
    const provider = new MockSttProvider([]);
    const errors: string[] = [];
    provider.onError((e) => errors.push(e.code));

    await provider.start();

    expect(errors).toEqual(["no-speech"]);
  });

  it("말하는 도중 멈추면 최종 결과가 나오지 않는다", async () => {
    // 사용자가 마이크 버튼에서 손을 떼는 상황. 중간 결과까지만 나오고 끝나야 한다.
    const provider = new MockSttProvider([
      { partials: ["돈", "돈 보"], text: "돈 보내기" },
    ]);
    const onFinal = vi.fn();
    provider.onFinal(onFinal);
    provider.onPartial((text) => {
      if (text === "돈 보") provider.stop();
    });

    await provider.start();

    expect(onFinal).not.toHaveBeenCalled();
  });

  it("구독을 해제할 수 있다", async () => {
    const provider = new MockSttProvider([{ text: "a" }, { text: "b" }]);
    const onFinal = vi.fn();
    const unsubscribe = provider.onFinal(onFinal);

    await provider.start();
    unsubscribe();
    await provider.start();

    expect(onFinal).toHaveBeenCalledTimes(1);
  });
});

describe("WebSpeechSttProvider", () => {
  it("API가 없는 환경에서는 지원하지 않는다고 알린다", () => {
    // jsdom에는 SpeechRecognition이 없다. 호스트는 이 값을 보고
    // 음성 버튼 대신 텍스트 검색만 노출한다 — 막다른 길을 만들지 않기 위해서다.
    expect(new WebSpeechSttProvider().isSupported).toBe(false);
  });

  it("지원하지 않는 환경에서 start()하면 오류로 알린다", async () => {
    const provider = new WebSpeechSttProvider();
    const codes: string[] = [];
    provider.onError((e) => codes.push(e.code));

    await provider.start();

    expect(codes).toEqual(["not-supported"]);
  });

  it("stop()은 시작 전에 불려도 안전하다", () => {
    expect(() => new WebSpeechSttProvider().stop()).not.toThrow();
  });
});
