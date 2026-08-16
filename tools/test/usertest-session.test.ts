import { describe, expect, it } from "vitest";
import { parseSession } from "../src/usertest-session.js";

/** 정상 봉투 하나. 각 테스트가 여기서 한 필드만 망가뜨린다. */
function envelope(): Record<string, unknown> {
  return {
    participant: "P01",
    ageBand: "60+",
    firstMode: "minui",
    runs: [
      {
        taskId: "T1",
        mode: "minui",
        targetMenuId: "inquiry.balance",
        startedAt: 0,
        endedAt: 12_000,
        elapsedMs: 12_000,
        taps: 1,
        screens: ["inquiry.balance"],
        offTarget: 0,
        completed: true,
      },
    ],
    interventions: { "T2:classic": 2 },
    words: { T2: ["자동으로 나가는 거"] },
    f9: "read-not-tapped",
    m7Repeat: "same",
  };
}

describe("parseSession", () => {
  it("정상 봉투를 그대로 읽는다", () => {
    const session = parseSession(envelope(), "P01.json");

    expect(session.participant).toBe("P01");
    expect(session.ageBand).toBe("60+");
    expect(session.runs[0]?.elapsedMs).toBe(12_000);
    expect(session.interventions["T2:classic"]).toBe(2);
    expect(session.words.T2).toEqual(["자동으로 나가는 거"]);
    expect(session.f9).toBe("read-not-tapped");
  });

  it("F9와 M7 반복은 없어도 된다 — 미수행일 수 있다", () => {
    const raw = envelope();
    delete raw.f9;
    delete raw.m7Repeat;

    const session = parseSession(raw, "P01.json");

    expect(session.f9).toBeUndefined();
    expect(session.m7Repeat).toBeUndefined();
  });

  it("interventions와 words는 없으면 빈 것으로 채운다", () => {
    const raw = envelope();
    delete raw.interventions;
    delete raw.words;

    const session = parseSession(raw, "P01.json");

    expect(session.interventions).toEqual({});
    expect(session.words).toEqual({});
  });

  // 조용히 넘기면 그 참가자가 통째로 표에서 사라지고, 8명 중 7명인 것을 아무도 모른다.
  it("연령대 오타는 파일 이름과 함께 실패한다", () => {
    const raw = { ...envelope(), ageBand: "60대" };

    expect(() => parseSession(raw, "P03.json")).toThrow(/P03\.json.*ageBand/s);
  });

  it("수행의 모드 오타도 잡는다", () => {
    const raw = envelope();
    (raw.runs as Record<string, unknown>[])[0]!.mode = "easy";

    expect(() => parseSession(raw, "P03.json")).toThrow(/P03\.json.*mode/s);
  });

  it("runs가 배열이 아니면 실패한다", () => {
    const raw = { ...envelope(), runs: {} };

    expect(() => parseSession(raw, "P03.json")).toThrow(/P03\.json.*runs/s);
  });

  it("참가자 번호가 없으면 실패한다", () => {
    const raw = envelope();
    delete raw.participant;

    expect(() => parseSession(raw, "P03.json")).toThrow(/P03\.json.*participant/s);
  });
});
