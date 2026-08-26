import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockSttProvider } from "../src/MockSttProvider.js";
import { WebSpeechSttProvider } from "../src/WebSpeechSttProvider.js";
import type { SttResult } from "../src/SttProvider.js";

/**
 * 브라우저 인식기를 흉내 낸다.
 *
 * <p>jsdom에는 `SpeechRecognition`이 없어서 지금까지는 "없을 때"만 테스트할 수 있었다.
 * 그런데 `finish()`가 지키는 것은 `stop()`과 `abort()`의 <b>차이</b>이고, 그 차이는
 * 인식기가 있어야만 드러난다. 쓰는 만큼만 흉내 낸다.
 */
function installFakeRecognition() {
  const calls = { started: 0, stopped: 0, aborted: 0 };
  let live: FakeRecognition | null = null;

  class FakeRecognition {
    lang = "";
    interimResults = false;
    continuous = false;
    maxAlternatives = 0;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;

    start() {
      calls.started += 1;
      live = this;
    }

    /** 지금까지 들은 것을 <b>확정</b>시킨다. 실제 브라우저는 여기서 최종 결과를 준다. */
    stop() {
      calls.stopped += 1;
    }

    /** 지금까지 들은 것을 <b>버린다.</b> */
    abort() {
      calls.aborted += 1;
    }
  }

  (globalThis as Record<string, unknown>)["SpeechRecognition"] = FakeRecognition;

  return {
    calls,
    /** 인식기가 최종 결과를 내보낸 척한다. */
    emitFinal(transcript: string, confidence: number) {
      live?.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: { length: 1, isFinal: true, 0: { transcript, confidence } },
        },
      });
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["SpeechRecognition"];
});

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

/**
 * 말이 끝나는 시점을 사용자가 정한다.
 *
 * <p>온디바이스 Whisper를 쓰던 동안 이 손잡이는 "스트리밍이 아닌 엔진"의 것이었다.
 * 엔진을 하나로 줄이면서 손잡이도 같이 지울 뻔했는데, <b>Web Speech에서도 값을 한다.</b>
 * 조용히 말하거나 도중에 말끝을 흐리는 사람은 브라우저가 `no-speech`로 끊을 때까지
 * 기다려야 했다 — 고령 사용자가 정확히 그렇게 말한다 (기획안 §9.2).
 */
describe("다 말했어요 — finish()", () => {
  it("버리지 않고 확정시킨다 — abort가 아니라 stop이다", async () => {
    const fake = installFakeRecognition();
    const stt = new WebSpeechSttProvider();
    await stt.start();

    stt.finish();

    // abort()는 지금까지 들은 것을 버린다. 조용히 말한 사람의 발화가 통째로 사라진다.
    expect(fake.calls.aborted).toBe(0);
    expect(fake.calls.stopped).toBe(1);
  });

  it("finish() 뒤에 오는 최종 결과를 그대로 내보낸다", async () => {
    const fake = installFakeRecognition();
    const stt = new WebSpeechSttProvider();
    const heard: string[] = [];
    stt.onFinal((r) => heard.push(r.text));
    await stt.start();

    stt.finish();
    // 실제 브라우저는 stop() 뒤에 확정된 결과를 준다. 핸들러가 살아 있어야 받는다.
    fake.emitFinal("자동이체", 0.9);

    expect(heard).toEqual(["자동이체"]);
  });

  it("stop()은 지금까지처럼 버린다 — 손을 뗀 것과 다 말한 것은 다르다", async () => {
    const fake = installFakeRecognition();
    const stt = new WebSpeechSttProvider();
    const heard: string[] = [];
    stt.onFinal((r) => heard.push(r.text));
    await stt.start();

    stt.stop();
    fake.emitFinal("자동이체", 0.9);

    expect(fake.calls.aborted).toBe(1);
    expect(heard).toEqual([]);
  });

  it("시작 전에 불려도 안전하다", () => {
    expect(() => new WebSpeechSttProvider().finish()).not.toThrow();
  });
});

/**
 * 이 패키지가 무엇에 기대는가.
 *
 * <p>AGENTS.md의 폴더 경계는 `@minui/voice`의 <b>본 진입점이 의존성 0</b>이라고 적어 두고,
 * 온디바이스 모델만 `@minui/voice/whisper` 서브패스에 optional peer로 뒀다. 그 서브패스가
 * 사라졌으므로 이제 예외 자체가 없다 — 규칙이 조건 없이 성립한다.
 */
describe("의존성 경계", () => {
  it("본 진입점도 서브패스도 아무것에도 기대지 않는다", async () => {
    const pkg = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;

    expect(pkg["dependencies"] ?? {}).toEqual({});
    // 온디바이스 모델이 사라졌으므로 optional peer도 남을 이유가 없다.
    expect(pkg["peerDependencies"] ?? {}).toEqual({});
    expect(pkg["peerDependenciesMeta"] ?? {}).toEqual({});
    expect(Object.keys(pkg["exports"] as object)).toEqual(["."]);
  });
});
