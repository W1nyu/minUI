import type { MenuItem } from "@minui/core";
import { describe, expect, it } from "vitest";
import { firstCards } from "../src/presets.js";

/**
 * 첫 화면 넉 장을 LLM 없이 고른다.
 *
 * <p>Studio가 LLM에게 물어보던 자리다. 물어봐도 품질이 좋지 않았고(`해지계좌 조회`를
 * 첫 화면에 올렸다), 무엇보다 <b>첫 화면은 오래 가는 결정이 아니다</b> — 사용자가
 * 몇 번 쓰면 랭킹이 밀어내고, 마음에 안 들면 고정으로 직접 바꾼다.
 * 짐작을 잘하는 것보다 짐작을 적게 하는 편이 낫다.
 */

const menu = (id: string, over: Partial<MenuItem> = {}): MenuItem => ({
  id,
  label: id,
  category: "조회",
  icon: "doc",
  route: `/${id}`,
  riskLevel: "low",
  ...over,
});

describe("첫 화면 프리셋", () => {
  it("카탈로그 앞에서부터 넉 장을 고른다", () => {
    const presets = firstCards([menu("a"), menu("b"), menu("c"), menu("d"), menu("e")]);
    expect(presets.inquiry).toEqual(["a", "b", "c", "d"]);
  });

  /** 온보딩 답과 무관하게 같은 넉 장이다. 구분할 근거가 없으면 지어내지 않는다. */
  it("세 부류가 모두 같은 넉 장을 받는다", () => {
    const presets = firstCards([menu("a"), menu("b"), menu("c"), menu("d")]);
    expect(presets.transfer).toEqual(presets.inquiry);
    expect(presets.invest).toEqual(presets.inquiry);
  });

  it("카드에 올릴 수 없는 메뉴는 건너뛴다", () => {
    const presets = firstCards([
      menu("시세", { cardable: false }),
      menu("a"),
      menu("호가", { cardable: false }),
      menu("b"),
      menu("c"),
      menu("d"),
      menu("e"),
    ]);
    expect(presets.inquiry).toEqual(["a", "b", "c", "d"]);
  });

  it("넉 장이 안 되면 있는 만큼만 준다", () => {
    expect(firstCards([menu("a"), menu("b")]).inquiry).toEqual(["a", "b"]);
    expect(firstCards([]).inquiry).toEqual([]);
  });

  it("몇 장을 고를지는 호스트가 정한다", () => {
    const presets = firstCards([menu("a"), menu("b"), menu("c")], 2);
    expect(presets.inquiry).toEqual(["a", "b"]);
  });
});
