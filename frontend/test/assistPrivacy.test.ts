import { describe, expect, it } from "vitest";
import { isSafeAssistQuery } from "@host-ai/assist";

describe("원격 도우미 개인정보 경계", () => {
  it("금액·계좌번호·송금·수취인 표현은 원격 도우미에 보내지 않는다", () => {
    expect(isSafeAssistQuery("삼촌에게 3만원 보내기")).toBe(false);
    expect(isSafeAssistQuery("110-234-567890 계좌 잔액")).toBe(false);
    expect(isSafeAssistQuery("김미영님 송금")).toBe(false);
  });

  it("금융 개인 데이터가 없는 기능 탐색 말만 도우미 후보가 된다", () => {
    expect(isSafeAssistQuery("자동이체를 멈추고 싶어요")).toBe(true);
  });
});
