import { describe, expect, it, vi } from "vitest";
import { FallbackSttProvider } from "../src/FallbackSttProvider.js";
import { MockSttProvider } from "../src/MockSttProvider.js";
import { WhisperSttProvider, type MicRecorder, type WhisperEngine } from "../src/WhisperSttProvider.js";
import { Listeners, type SttError, type SttProvider, type SttResult } from "../src/SttProvider.js";

/** 녹음을 흉내 낸다. 실제 마이크는 jsdom에 없다. */
function fakeRecorder(pcm: Float32Array, over: Partial<MicRecorder> = {}): MicRecorder {
  return {
    isSupported: true,
    start: async () => {},
    stop: async () => pcm,
    ...over,
  };
}

const engineSaying = (text: string): WhisperEngine => ({
  transcribe: async () => text,
});

describe("WhisperSttProvider", () => {
  it("녹음을 멈추면 그 소리를 엔진에 넘기고 결과를 낸다", async () => {
    const pcm = new Float32Array([0.1, 0.2]);
    const transcribe = vi.fn(async () => "자동이체 해지");
    const provider = new WhisperSttProvider({
      engine: { transcribe },
      recorder: fakeRecorder(pcm),
    });
    const results: SttResult[] = [];
    provider.onFinal((r) => results.push(r));

    await provider.start();
    await provider.finish();

    expect(transcribe).toHaveBeenCalledWith(pcm);
    expect(results).toEqual([{ text: "자동이체 해지", confidence: 1 }]);
  });

  /*
   * Whisper는 신뢰도를 주지 않는다. WebSpeech에서 신뢰도를 안 주는 브라우저를
   * 1로 두기로 한 것과 같은 판단이다 — 판단을 미루지 않고, 대신 §9.3의 위험도
   * 규칙이 여전히 자동 실행을 막는다.
   */
  it("신뢰도를 주지 않으므로 1로 채운다", async () => {
    const provider = new WhisperSttProvider({
      engine: engineSaying("잔액"),
      recorder: fakeRecorder(new Float32Array(1)),
    });
    const results: SttResult[] = [];
    provider.onFinal((r) => results.push(r));

    await provider.start();
    await provider.finish();

    expect(results[0]!.confidence).toBe(1);
  });

  /** 스트리밍이 아니다. 말하는 도중에는 보여 줄 것이 없다. */
  it("중간 결과를 내지 않는다", async () => {
    const onPartial = vi.fn();
    const provider = new WhisperSttProvider({
      engine: engineSaying("잔액"),
      recorder: fakeRecorder(new Float32Array(1)),
    });
    provider.onPartial(onPartial);

    await provider.start();
    await provider.finish();

    expect(onPartial).not.toHaveBeenCalled();
  });

  it("아무 말도 못 알아들으면 no-speech다", async () => {
    const provider = new WhisperSttProvider({
      engine: engineSaying("   "),
      recorder: fakeRecorder(new Float32Array(1)),
    });
    const codes: string[] = [];
    provider.onError((e) => codes.push(e.code));

    await provider.start();
    await provider.finish();

    expect(codes).toEqual(["no-speech"]);
  });

  it("마이크를 못 쓰면 권한 오류로 알린다", async () => {
    const provider = new WhisperSttProvider({
      engine: engineSaying("잔액"),
      recorder: fakeRecorder(new Float32Array(1), {
        start: async () => {
          throw new Error("NotAllowedError");
        },
      }),
    });
    const codes: string[] = [];
    provider.onError((e) => codes.push(e.code));

    await provider.start();

    expect(codes).toEqual(["permission-denied"]);
  });

  it("모델이 죽어도 화면은 살아 있다 — 오류로 알리고 끝낸다", async () => {
    const provider = new WhisperSttProvider({
      engine: {
        transcribe: async () => {
          throw new Error("모델을 못 받았습니다");
        },
      },
      recorder: fakeRecorder(new Float32Array(1)),
    });
    const codes: string[] = [];
    provider.onError((e) => codes.push(e.code));

    await provider.start();
    await provider.finish();

    expect(codes).toEqual(["unknown"]);
  });

  it("녹음할 수 없는 환경이면 지원하지 않는다고 알린다", () => {
    const provider = new WhisperSttProvider({
      engine: engineSaying("잔액"),
      recorder: fakeRecorder(new Float32Array(1), { isSupported: false }),
    });

    expect(provider.isSupported).toBe(false);
  });

  it("stop()은 시작 전에 불려도 안전하다", () => {
    const provider = new WhisperSttProvider({
      engine: engineSaying("잔액"),
      recorder: fakeRecorder(new Float32Array(1)),
    });

    expect(() => provider.stop()).not.toThrow();
  });
});

/** 지원 여부와 start 실패를 마음대로 정할 수 있는 최소 구현체. */
function stub(options: { isSupported: boolean; failOnStart?: boolean }): SttProvider {
  const final = new Listeners<SttResult>();
  const error = new Listeners<SttError>();
  return {
    isSupported: options.isSupported,
    start: async () => {
      if (options.failOnStart) throw new Error("못 뜬다");
      final.emit({ text: "떴다", confidence: 1 });
    },
    stop: () => {},
    onPartial: () => () => {},
    onFinal: (cb) => final.add(cb),
    onError: (cb) => error.add(cb),
  };
}

describe("FallbackSttProvider — 주 엔진과 예비 엔진", () => {
  it("첫 번째가 쓸 수 있으면 그것을 쓴다", async () => {
    const primary = new MockSttProvider([{ text: "주 엔진" }]);
    const backup = new MockSttProvider([{ text: "예비 엔진" }]);
    const provider = new FallbackSttProvider([primary, backup]);
    const heard: string[] = [];
    provider.onFinal((r) => heard.push(r.text));

    await provider.start();

    expect(heard).toEqual(["주 엔진"]);
  });

  it("첫 번째를 못 쓰는 환경이면 예비로 넘어간다", async () => {
    const backup = new MockSttProvider([{ text: "예비 엔진" }]);
    const provider = new FallbackSttProvider([stub({ isSupported: false }), backup]);
    const heard: string[] = [];
    provider.onFinal((r) => heard.push(r.text));

    await provider.start();

    expect(heard).toEqual(["예비 엔진"]);
  });

  /** 모델 내려받기 실패처럼 실제로 켜 봐야 아는 실패. */
  it("첫 번째가 시작하다 죽으면 예비로 넘어간다", async () => {
    const backup = new MockSttProvider([{ text: "예비 엔진" }]);
    const provider = new FallbackSttProvider([
      stub({ isSupported: true, failOnStart: true }),
      backup,
    ]);
    const heard: string[] = [];
    provider.onFinal((r) => heard.push(r.text));

    await provider.start();

    expect(heard).toEqual(["예비 엔진"]);
  });

  it("한 번 죽은 엔진은 다시 부르지 않는다", async () => {
    const dying = stub({ isSupported: true, failOnStart: true });
    const spy = vi.spyOn(dying, "start");
    const provider = new FallbackSttProvider([dying, new MockSttProvider([{ text: "예비" }])]);

    await provider.start();
    await provider.start();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("아무도 못 쓰면 지원하지 않는다고 알린다", async () => {
    const provider = new FallbackSttProvider([
      stub({ isSupported: false }),
      stub({ isSupported: false }),
    ]);
    const codes: string[] = [];
    provider.onError((e) => codes.push(e.code));

    expect(provider.isSupported).toBe(false);
    await provider.start();

    expect(codes).toEqual(["not-supported"]);
  });

  it("하나라도 쓸 수 있으면 지원한다고 알린다", () => {
    const provider = new FallbackSttProvider([
      stub({ isSupported: false }),
      stub({ isSupported: true }),
    ]);

    expect(provider.isSupported).toBe(true);
  });

  it("stop()은 켜져 있는 엔진에 간다", async () => {
    const primary = new MockSttProvider([{ partials: ["돈"], text: "돈 보내기", holdFinal: true }]);
    const spy = vi.spyOn(primary, "stop");
    const provider = new FallbackSttProvider([primary]);

    await provider.start();
    provider.stop();

    expect(spy).toHaveBeenCalled();
  });
});
