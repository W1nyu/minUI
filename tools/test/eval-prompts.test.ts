import { describe, expect, it } from "vitest";
import { dropNearDuplicates, makeEnvelope, pickEvenly } from "../src/eval-prompts.js";

/**
 * 봉투는 **정답의 글자를 흘리면 안 된다.**
 *
 * <p>§0의 흠은 "질의도 내가 쓰고 동의어도 내가 썼다"였다. 고치려면 질의를 쓰는 사람이
 * <b>정답의 글자를 본 적이 없어야</b> 한다. 그런데 무엇을 하는 화면인지는 알려 줘야
 * 질의를 쓸 수 있으므로, 설명이 필요하다 — 그 설명이 라벨이나 동의어를 그대로 담고 있으면
 * 참가자가 그것을 따라 쓰고 <b>같은 오염이 새 세트에서 재현된다.</b>
 *
 * <p>그래서 설명을 코드가 검사한다. 사람이 "이건 안 흘리는 것 같다"고 고르면 그 판단이
 * 또 오염이다.
 */
describe("makeEnvelope — 설명이 정답을 흘리는가", () => {
  it("설명에 라벨이 통째로 들어 있으면 못 쓴다", () => {
    const envelope = makeEnvelope({
      menuId: "a",
      label: "펀드몰",
      terms: ["펀드몰"],
      hint: "다양한 펀드몰 상품을 모아둔 곳",
      path: [],
    });

    expect(envelope.usable).toBe(false);
  });

  it("설명이 동의어의 글자를 나눠 가져도 못 쓴다", () => {
    // 참가자가 설명을 보고 그 말을 그대로 쓰면 새 세트가 같은 오염을 갖는다.
    const envelope = makeEnvelope({
      menuId: "a",
      label: "신상펀드",
      terms: ["신상펀드", "새 펀드"],
      hint: "새로 나온 펀드 상품",
      path: [],
    });

    expect(envelope.usable).toBe(false);
  });

  it("글자가 안 겹치는 설명이면 쓸 수 있다", () => {
    /*
     * 이런 것이 정확히 재고 싶은 경우다 — 사용자가 라벨의 말을 쓰지 않는 화면.
     * `수신`을 "돈 맡기는 것"이라고 아는 사람은 "수신"이라고 말하지 않는다.
     */
    const envelope = makeEnvelope({
      menuId: "a",
      label: "수신",
      terms: ["수신"],
      hint: "돈을 맡겨 두는 것",
      path: [],
    });

    expect(envelope.usable).toBe(true);
    expect(envelope.description).toBe("돈을 맡겨 두는 것");
  });

  it("흘리는 갈래 조각은 버리지 않고 가린다", () => {
    /*
     * 갈래도 봉투에 함께 찍히므로 검사해야 한다. 다만 흘린다고 메뉴를 통째로 버리면
     * 쓸 수 있는 문항이 지나치게 준다 — 흘리는 조각만 빼면 봉투는 깨끗해지고,
     * 남은 갈래가 참가자에게 "어느 영역의 이야기인지"를 알려 준다.
     *
     * 갈래를 통째로 지우지 않는 이유가 그것이다. 맥락이 없으면 참가자가 엉뚱한 질의를 쓴다.
     */
    const envelope = makeEnvelope({
      menuId: "a",
      label: "펀드몰",
      terms: ["펀드몰"],
      hint: "여러 상품을 모아둔 곳",
      path: ["금융상품", "펀드"],
    });

    expect(envelope.usable).toBe(true);
    expect(envelope.context).toEqual(["금융상품"]);
  });

  it("설명이 없으면 못 쓴다 — 빈 봉투로는 질의를 쓸 수 없다", () => {
    const envelope = makeEnvelope({
      menuId: "a",
      label: "수신",
      terms: ["수신"],
      path: [],
    });

    expect(envelope.usable).toBe(false);
  });

  it("한 글자 겹침은 흘린 것으로 보지 않는다", () => {
    // 파이프라인의 포함 판정도 한 글자는 뺀다. 재는 눈이 같아야 한다.
    const envelope = makeEnvelope({
      menuId: "a",
      label: "이체",
      terms: ["이체"],
      hint: "남에게 돈을 보내는 일",
      path: [],
    });

    expect(envelope.usable).toBe(true);
  });
});

describe("pickEvenly — 사이트마다 고르게, 그리고 늘 같게", () => {
  const pool = Array.from({ length: 20 }, (_, i) => `m${i}`);

  it("요청한 수만큼 고른다", () => {
    expect(pickEvenly(pool, 7)).toHaveLength(7);
  });

  it("풀보다 많이 달라고 하면 있는 만큼만 준다", () => {
    expect(pickEvenly(pool, 100)).toHaveLength(20);
  });

  it("같은 입력은 늘 같은 것을 낸다 — 문항지를 다시 뽑아도 같아야 한다", () => {
    // 참가자마다 다른 문항을 받으면 결과를 합칠 수 없다.
    expect(pickEvenly(pool, 7)).toEqual(pickEvenly(pool, 7));
  });

  it("앞에서 자르지 않는다 — 카탈로그 순서는 수집 DOM 순서라 한쪽에 몰린다", () => {
    expect(pickEvenly(pool, 5)).not.toEqual(pool.slice(0, 5));
  });
});

describe("dropNearDuplicates — 같은 질문을 두 번 하지 않는다", () => {
  it("설명이 거의 같은 문항은 하나만 남긴다", () => {
    /*
     * 실제로 뽑아 보니 나란히 나왔다. 참가자에게는 같은 질문을 두 번 하는 것으로 읽히고,
     * 둘에 다른 답을 쓰려다 평소 안 쓰는 말이 나온다 — 그것은 잰 값이 아니다.
     */
    const kept = dropNearDuplicates([
      "물건 살 때 안전 결제 확인",
      "안전결제 거래가 잘 되었는지 확인",
      "법원에 맡기는 돈",
    ]);

    expect(kept).toEqual([0, 2]);
  });

  it("다른 이야기는 둘 다 남긴다", () => {
    const kept = dropNearDuplicates(["돈을 맡겨 두는 것", "남에게 돈을 보내는 일"]);

    expect(kept).toEqual([0, 1]);
  });

  it("먼저 온 것을 남긴다 — 고르게 뽑은 순서에 의미가 있다", () => {
    const kept = dropNearDuplicates(["잔액을 확인하는 화면", "잔액을 확인하는 곳"]);

    expect(kept).toEqual([0]);
  });
});
