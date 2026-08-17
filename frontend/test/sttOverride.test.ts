import { MockSttProvider } from "@minui/voice";
import { describe, expect, it } from "vitest";
import { ScriptedOverrideStt } from "../src/instrumentation/ScriptedOverrideStt.js";

function harness(script: NonNullable<ConstructorParameters<typeof MockSttProvider>[0]>) {
  const stt = new ScriptedOverrideStt(new MockSttProvider(script));
  const finals: string[] = [];
  const partials: string[] = [];
  const errors: string[] = [];

  stt.onFinal((result) => finals.push(result.text));
  stt.onPartial((text) => partials.push(text));
  stt.onError((error) => errors.push(error.code));

  return { stt, finals, partials, errors };
}

describe("ScriptedOverrideStt", () => {
  it("넣어 둔 것이 없으면 실제 인식 결과가 그대로 나온다", async () => {
    const { stt, finals } = harness([{ text: "잔액 얼마야" }]);

    await stt.start();

    expect(finals).toEqual(["잔액 얼마야"]);
  });

  it("넣어 두면 최종 전사가 그것으로 바뀐다", async () => {
    const { stt, finals } = harness([{ text: "우리 딸한테 삼십만원 보내줘" }]);

    stt.next("우리 딸한테 십삼만원 보내줘");
    await stt.start();

    expect(finals).toEqual(["우리 딸한테 십삼만원 보내줘"]);
  });

  // 한 번 쓰고도 남아 있으면 다음 과제까지 오염된다.
  it("한 번 쓰면 소진된다", async () => {
    const { stt, finals } = harness([{ text: "첫 번째" }, { text: "두 번째" }]);

    stt.next("넣어 둔 것");
    await stt.start();
    await stt.start();

    expect(finals).toEqual(["넣어 둔 것", "두 번째"]);
  });

  // 고령 발화에서 STT가 흔들려도 F9 프로토콜은 굴러가야 한다.
  it("실제 인식이 실패해도 넣어 둔 것이 최종 결과로 나간다", async () => {
    const { stt, finals, errors } = harness([
      { text: "", error: { code: "no-speech", message: "못 들었습니다." } },
    ]);

    stt.next("우리 딸한테 십삼만원 보내줘");
    await stt.start();

    expect(finals).toEqual(["우리 딸한테 십삼만원 보내줘"]);
    expect(errors).toEqual([]);
  });

  it("넣어 둔 것이 없으면 오류는 오류대로 간다", async () => {
    const { stt, finals, errors } = harness([
      { text: "", error: { code: "no-speech", message: "못 들었습니다." } },
    ]);

    await stt.start();

    expect(finals).toEqual([]);
    expect(errors).toEqual(["no-speech"]);
  });

  // 참가자는 자기가 한 말을 화면에서 봐야 한다. 중간 결과까지 갈면 조작이 드러난다.
  it("중간 결과는 언제나 실제 그대로다", async () => {
    const { stt, partials } = harness([
      { partials: ["우리 딸", "우리 딸한테 삼십만원"], text: "우리 딸한테 삼십만원 보내줘" },
    ]);

    stt.next("우리 딸한테 십삼만원 보내줘");
    await stt.start();

    expect(partials).toEqual(["우리 딸", "우리 딸한테 삼십만원"]);
  });

  it("clear로 넣어 둔 것을 되돌린다", async () => {
    const { stt, finals } = harness([{ text: "실제 결과" }]);

    stt.next("넣어 둔 것");
    stt.clear();
    await stt.start();

    expect(finals).toEqual(["실제 결과"]);
  });

  it("감싼 provider의 지원 여부를 그대로 물려받는다", () => {
    const { stt } = harness([]);

    expect(stt.isSupported).toBe(true);
  });

  /*
   * 조용히 끝나는 엔진 — 실제 Web Speech가 그렇다.
   *
   * `WebSpeechSttProvider`에는 `finish()`가 없어서 `FallbackSttProvider.finish()`가
   * `stop()`으로 내려가고, `stop()`은 핸들러를 전부 null로 만들고 abort한다.
   * **최종 결과도 오류도 나오지 않는다.** 참가자가 말없이 "다 말했어요"를 누르면
   * 정확히 이 경로다.
   */
  function silentInner() {
    const listeners = { partial: [] as ((t: string) => void)[] };
    let stopped = false;
    return {
      isSupported: true,
      start: async () => {},
      stop: () => {
        stopped = true;
      },
      finish: () => {},
      onPartial: (cb: (t: string) => void) => {
        listeners.partial.push(cb);
        return () => {};
      },
      onFinal: () => () => {},
      onError: () => () => {},
      get stopped() {
        return stopped;
      },
    };
  }

  it("말없이 끝내도 넣어 둔 것이 나간다 — 조용히 끝나는 엔진", async () => {
    const inner = silentInner();
    const stt = new ScriptedOverrideStt(inner);
    const finals: string[] = [];
    stt.onFinal((result) => finals.push(result.text));

    stt.next("우리 딸한테 십삼만원 보내줘");
    await stt.start();
    await stt.finish?.();

    expect(finals).toEqual(["우리 딸한테 십삼만원 보내줘"]);
    // 마이크는 닫아야 한다. 열어 둔 채 결과만 내보내면 불이 켜진 채로 남는다.
    expect(inner.stopped).toBe(true);
  });

  it("넣어 둔 것이 없으면 finish는 그냥 감싼 쪽으로 간다", async () => {
    const inner = silentInner();
    const stt = new ScriptedOverrideStt(inner);
    const finals: string[] = [];
    stt.onFinal((result) => finals.push(result.text));

    await stt.start();
    await stt.finish?.();

    expect(finals).toEqual([]);
    expect(inner.stopped).toBe(false);
  });
});
