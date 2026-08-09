import { describe, expect, it } from "vitest";
import { LayoutStabilizer } from "../src/LayoutStabilizer.js";
import { DAY_MS, DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import { T0, emptyLayout, rankedList } from "./helpers.js";

const stabilizer = new LayoutStabilizer(DEFAULT_CONFIG);

/** 카드 4장이 자리 잡은 상태를 만든다. */
function seeded() {
  const ranked = rankedList([
    ["a", 4],
    ["b", 3],
    ["c", 2],
    ["d", 1],
  ]);
  return stabilizer.recompute(emptyLayout(), ranked, T0).state;
}

describe("최초 배치", () => {
  it("빈 화면에는 랭킹 상위 N개가 그대로 들어간다", () => {
    const state = seeded();
    expect(state.current).toEqual(["a", "b", "c", "d"]);
    expect(state.pending).toBeNull();
  });

  it("최초 배치 카드에는 '새로 추가됨' 배지가 붙지 않는다", () => {
    // 첫 화면은 전부 새것이다. 전부에 배지를 달면 배지가 정보를 잃는다.
    const state = seeded();
    const cards = stabilizer.cards(state, rankedList([["a", 4]]), [], T0);
    expect(cards.every((c) => !c.isNew)).toBe(true);
  });
});

describe("히스테리시스 ① 20% 마진 (기획안 §8.2)", () => {
  const later = T0 + 2 * DAY_MS;

  it("마진에 못 미치는 도전자는 카드를 밀어내지 못한다", () => {
    const state = seeded();
    // 최약체 d(1.0)를 노리는 도전자 1.19 — 20% 마진에 미달
    const ranked = rankedList([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
      ["e", 1.19],
    ]);

    const result = stabilizer.recompute(state, ranked, later);
    expect(result.swaps).toEqual([]);
    expect(result.state.pending).toBeNull();
    expect(result.state.current).toEqual(["a", "b", "c", "d"]);
  });

  it("마진을 넘는 도전자는 교체를 일으킨다", () => {
    const state = seeded();
    const ranked = rankedList([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
      ["e", 1.5],
    ]);

    const result = stabilizer.recompute(state, ranked, later);
    expect(result.swaps).toEqual([{ out: "d", in: "e" }]);
  });

  it("경계값(정확히 1.20배)은 교체하지 않는다 — 조건이 '초과'다", () => {
    const state = seeded();
    const ranked = rankedList([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
      ["e", 1.2],
    ]);

    expect(stabilizer.recompute(state, ranked, later).swaps).toEqual([]);
  });

  it("가장 약한 카드가 교체 대상이 된다", () => {
    const state = seeded();
    const ranked = rankedList([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
      ["e", 2.9],
    ]);

    // e(2.9)는 c(2.0)도 넘지만, 먼저 나갈 대상은 최약체 d다
    expect(stabilizer.recompute(state, ranked, later).swaps).toEqual([
      { out: "d", in: "e" },
    ]);
  });

  it("입력이 정렬돼 있지 않아도 가장 강한 도전자를 고른다", () => {
    // 콜드 스타트 랭킹은 프리셋 순서로 만들어져 점수 내림차순이 아니다.
    // 정렬을 입력 쪽에 맡기면 강한 도전자가 배열 뒤에 있을 때 조용히 무시된다.
    const state = seeded();
    const unsorted = [
      { menuId: "a", frequency: 4, recency: 0, context: 0, pin: 0, total: 4 },
      { menuId: "b", frequency: 3, recency: 0, context: 0, pin: 0, total: 3 },
      { menuId: "c", frequency: 2, recency: 0, context: 0, pin: 0, total: 2 },
      { menuId: "d", frequency: 1, recency: 0, context: 0, pin: 0, total: 1 },
      { menuId: "weak", frequency: 0.5, recency: 0, context: 0, pin: 0, total: 0.5 },
      { menuId: "strong", frequency: 0, recency: 0, context: 0, pin: 100, total: 100 },
    ];

    const result = stabilizer.recompute(state, unsorted, T0 + 2 * DAY_MS);

    expect(result.swaps).toEqual([{ out: "d", in: "strong" }]);
  });

  it("현직이 전부 동점이면 뒤쪽 자리가 먼저 나간다", () => {
    // 콜드 스타트 직후 프리셋 카드가 전부 0점인 상황. 첫 자리를 먼저 비우면
    // 온보딩으로 정한 가장 중요한 카드가 제일 먼저 사라진다.
    const state = stabilizer.recompute(
      emptyLayout(),
      rankedList([
        ["a", 0],
        ["b", 0],
        ["c", 0],
        ["d", 0],
      ]),
      T0,
    ).state;

    const result = stabilizer.recompute(
      state,
      rankedList([
        ["a", 0],
        ["b", 0],
        ["c", 0],
        ["d", 0],
        ["e", 5],
      ]),
      T0 + 2 * DAY_MS,
    );

    expect(result.swaps).toEqual([{ out: "d", in: "e" }]);
  });
});

describe("히스테리시스 ② 24시간 쿨다운", () => {
  const strong = rankedList([
    ["a", 4],
    ["b", 3],
    ["c", 2],
    ["d", 1],
    ["e", 10],
  ]);

  it("마지막 재배치로부터 24시간이 안 지났으면 교체하지 않는다", () => {
    const state = seeded();
    const result = stabilizer.recompute(state, strong, T0 + 23 * 3600_000);
    expect(result.swaps).toEqual([]);
  });

  it("24시간이 지나면 교체한다", () => {
    const state = seeded();
    const result = stabilizer.recompute(state, strong, T0 + DAY_MS);
    expect(result.swaps).toHaveLength(1);
  });

  it("교체가 없었던 시도는 쿨다운을 다시 시작시키지 않는다", () => {
    const state = seeded();
    const weak = rankedList([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
      ["e", 1.1],
    ]);

    // 이틀 뒤: 도전자가 약해 교체 없음
    const noSwap = stabilizer.recompute(state, weak, T0 + 2 * DAY_MS);
    expect(noSwap.swaps).toEqual([]);

    // 그 1시간 뒤 강한 도전자가 나타나면 24시간을 또 기다리지 않는다
    const later = stabilizer.recompute(noSwap.state, strong, T0 + 2 * DAY_MS + 3600_000);
    expect(later.swaps).toHaveLength(1);
  });
});

describe("히스테리시스 ③ 한 번에 한 장", () => {
  it("도전자가 여럿이어도 한 번의 재배치에서 한 장만 바뀐다", () => {
    const state = seeded();
    const ranked = rankedList([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
      ["e", 20],
      ["f", 19],
      ["g", 18],
    ]);

    const result = stabilizer.recompute(state, ranked, T0 + 2 * DAY_MS);
    expect(result.swaps).toHaveLength(1);
    expect(result.state.pending).toHaveLength(4);
  });

  it("설정을 올리면 그만큼 바뀐다", () => {
    const cfg = resolveConfig({ stability: { maxSwapsPerRecompute: 2 } });
    const s = new LayoutStabilizer(cfg);
    const state = s.recompute(
      emptyLayout(),
      rankedList([
        ["a", 4],
        ["b", 3],
        ["c", 2],
        ["d", 1],
      ]),
      T0,
    ).state;

    const result = s.recompute(
      state,
      rankedList([
        ["a", 4],
        ["b", 3],
        ["c", 2],
        ["d", 1],
        ["e", 20],
        ["f", 19],
      ]),
      T0 + 2 * DAY_MS,
    );
    expect(result.swaps).toHaveLength(2);
  });
});

describe("지연 커밋 — 세션 도중에는 화면이 바뀌지 않는다", () => {
  const ranked = rankedList([
    ["a", 4],
    ["b", 3],
    ["c", 2],
    ["d", 1],
    ["e", 10],
  ]);

  it("교체가 확정돼도 current는 그대로고 pending에만 쌓인다", () => {
    const state = seeded();
    const result = stabilizer.recompute(state, ranked, T0 + 2 * DAY_MS);

    expect(result.state.current).toEqual(["a", "b", "c", "d"]);
    expect(result.state.pending).toEqual(["a", "b", "c", "e"]);
    expect(result.appliedNow).toBe(false);
  });

  it("다음 세션 시작 때 반영된다", () => {
    const state = stabilizer.recompute(seeded(), ranked, T0 + 2 * DAY_MS).state;
    const next = stabilizer.startSession(state, T0 + 3 * DAY_MS);

    expect(next.current).toEqual(["a", "b", "c", "e"]);
    expect(next.pending).toBeNull();
  });

  it("교체된 카드는 나간 카드의 자리에 들어간다 — 나머지 위치는 그대로", () => {
    // 근육 기억을 지키려면 한 장이 바뀔 때 다른 카드가 움직이면 안 된다.
    const state = seeded();
    const pushOutB = rankedList([
      ["a", 4],
      ["b", 0.5],
      ["c", 2],
      ["d", 1],
      ["e", 3],
    ]);

    const after = stabilizer.startSession(
      stabilizer.recompute(state, pushOutB, T0 + 2 * DAY_MS).state,
      T0 + 3 * DAY_MS,
    );

    expect(after.current).toEqual(["a", "e", "c", "d"]);
  });

  it("랭킹 순서가 바뀌어도 남아 있는 카드의 자리는 흔들리지 않는다", () => {
    const state = seeded();
    const reordered = rankedList([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);

    const result = stabilizer.recompute(state, reordered, T0 + 2 * DAY_MS);
    expect(result.state.current).toEqual(["a", "b", "c", "d"]);
    expect(result.state.pending).toBeNull();
  });
});

describe("변경 고지 — '새로 추가됨' 배지", () => {
  const ranked = rankedList([
    ["a", 4],
    ["b", 3],
    ["c", 2],
    ["d", 1],
    ["e", 10],
  ]);

  function afterSwap() {
    const swapped = stabilizer.recompute(seeded(), ranked, T0 + 2 * DAY_MS).state;
    return stabilizer.startSession(swapped, T0 + 3 * DAY_MS);
  }

  it("교체로 들어온 카드에만 배지가 붙는다", () => {
    const state = afterSwap();
    const cards = stabilizer.cards(state, ranked, [], T0 + 3 * DAY_MS);
    const badged = cards.filter((c) => c.isNew).map((c) => c.menuId);

    expect(badged).toEqual(["e"]);
  });

  it("3일이 지나면 배지가 사라진다", () => {
    const state = afterSwap();
    const cards = stabilizer.cards(state, ranked, [], T0 + 3 * DAY_MS + 3 * DAY_MS + 1);

    expect(cards.every((c) => !c.isNew)).toBe(true);
  });
});

describe("카탈로그 변화", () => {
  it("랭킹 후보에서 사라진 메뉴는 마진·쿨다운과 무관하게 즉시 빠진다", () => {
    // 호스트 앱이 메뉴를 없앤 경우. 눌리면 깨지는 카드를 24시간 두는 것이 더 나쁘다.
    const state = seeded();
    const ranked = rankedList([
      ["a", 4],
      ["b", 3],
      ["d", 1],
      ["x", 0.1],
    ]);

    const result = stabilizer.recompute(state, ranked, T0 + 60_000);
    expect(result.appliedNow).toBe(true);
    expect(result.state.current).toEqual(["a", "b", "x", "d"]);
  });

  it("즉시 반영이 일어나면 대기 중이던 pending은 버려진다", () => {
    // pending은 옛 화면을 기준으로 계산된 것이라 그대로 적용하면 앞뒤가 안 맞는다.
    const withPending = stabilizer.recompute(
      seeded(),
      rankedList([
        ["a", 4],
        ["b", 3],
        ["c", 2],
        ["d", 1],
        ["e", 10],
      ]),
      T0 + 2 * DAY_MS,
    ).state;
    expect(withPending.pending).not.toBeNull();

    const shrunk = stabilizer.recompute(
      withPending,
      rankedList([
        ["a", 4],
        ["b", 3],
        ["d", 1],
        ["x", 0.1],
      ]),
      T0 + 2 * DAY_MS + 60_000,
    );

    expect(shrunk.state.pending).toBeNull();
  });

  it("후보가 카드 수보다 적으면 있는 만큼만 배치한다", () => {
    const result = stabilizer.recompute(
      emptyLayout(),
      rankedList([
        ["a", 4],
        ["b", 3],
      ]),
      T0,
    );
    expect(result.state.current).toEqual(["a", "b"]);
  });
});

describe("수동 고정 — 자동화의 탈출구", () => {
  it("force면 쿨다운을 무시하고 즉시 반영한다", () => {
    // 사용자가 직접 고정한 결과가 24시간 뒤에 나타나면 탈출구 구실을 못 한다.
    const state = seeded();
    const pinnedRanking = rankedList([
      ["z", 100], // 핀 가중치가 실린 메뉴
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
    ]);

    const result = stabilizer.recompute(state, pinnedRanking, T0 + 60_000, {
      force: true,
    });

    expect(result.appliedNow).toBe(true);
    expect(result.state.current).toContain("z");
    expect(result.state.pending).toBeNull();
  });

  it("고정 카드는 배지 계산에서 pinned로 표시된다", () => {
    const state = seeded();
    const cards = stabilizer.cards(
      state,
      rankedList([
        ["a", 4],
        ["b", 3],
        ["c", 2],
        ["d", 1],
      ]),
      ["b"],
      T0,
    );

    expect(cards.find((c) => c.menuId === "b")?.pinned).toBe(true);
    expect(cards.find((c) => c.menuId === "a")?.pinned).toBe(false);
  });
});

describe("cards()", () => {
  it("화면에 보이는 순서 그대로, 점수를 함께 돌려준다", () => {
    const state = seeded();
    const ranked = rankedList([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
    ]);

    const cards = stabilizer.cards(state, ranked, [], T0);
    expect(cards.map((c) => c.menuId)).toEqual(["a", "b", "c", "d"]);
    expect(cards.map((c) => c.score)).toEqual([4, 3, 2, 1]);
  });
});
