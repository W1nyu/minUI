import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { calibrate, mergeNeural, type NeuralSettings } from "../src/search/neural.js";
import type { SearchCandidate } from "../src/search/stages.js";
import type { MenuId } from "../src/types.js";

const SETTINGS: NeuralSettings = {
  ...DEFAULT_CONFIG.search.neural,
  enabled: true,
  scoreFloor: 0.72,
  scoreCeiling: 0.92,
  weight: 0.85,
  maxMatches: 20,
};

const KNOWN = new Set<MenuId>(["transfer.now", "inquiry.balance", "transfer.auto"]);

function local(
  menuId: string,
  score: number,
  matchedBy: SearchCandidate["matchedBy"],
  matchedTerm = "이체",
): SearchCandidate {
  return { menuId, score, matchedBy, matchedTerm };
}

/**
 * 원점수를 로컬 점수와 같은 자로 옮긴다.
 *
 * <p>여기가 M11에서 가장 조용히 실패할 수 있는 자리다. 코사인은 <b>무관한 메뉴에도</b>
 * 0.6~0.7을 준다. `minConfidence: 0.4`는 n-gram의 희소한 분포(대부분 정확히 0)에 맞춰
 * 고른 값이라, 원점수를 그대로 들이면 "날씨 어때"가 아무 메뉴나 0.68로 집는다.
 * 그러면 "답 없는 질의 100건 중 97건 옳게 거절"이 무너진다 — 이 프로젝트가 내세우는
 * 수치 중 하나이고, 정확도보다 지키기 어려운 쪽이다.
 */
describe("calibrate — 원점수를 로컬 점수와 같은 자로", () => {
  it("바닥 아래는 정확히 0이다", () => {
    // 이 한 줄이 부정 질의의 옳은 거절을 지킨다. 0.68은 "무관"의 전형적인 코사인이다.
    expect(calibrate(0.68, SETTINGS)).toBe(0);
    expect(calibrate(0.72, SETTINGS)).toBe(0);
  });

  it("천장 위는 붙는다 — 그 위의 차이는 순서에만 쓰고 점수로는 세지 않는다", () => {
    expect(calibrate(0.92, SETTINGS)).toBeCloseTo(0.85);
    expect(calibrate(0.99, SETTINGS)).toBeCloseTo(0.85);
    expect(calibrate(1, SETTINGS)).toBeCloseTo(0.85);
  });

  it("사이는 단조다 — 순서를 뒤집지 않는다", () => {
    // 단조라는 것이 중요하다. 캘리브레이션이 회수 성능을 <b>악화시킬 수는 없고</b>
    // 문턱이 어디서 무는지만 바꾼다. 그래서 회수와 거절을 따로 잴 수 있다.
    expect(calibrate(0.8, SETTINGS)).toBeLessThan(calibrate(0.85, SETTINGS));
    expect(calibrate(0.85, SETTINGS)).toBeLessThan(calibrate(0.9, SETTINGS));
  });

  it("천장이 바닥보다 낮게 설정되면 0을 낸다 — 설정 실수로 아무거나 통과시키지 않는다", () => {
    expect(calibrate(0.99, { ...SETTINGS, scoreFloor: 0.9, scoreCeiling: 0.5 })).toBe(0);
  });
});

describe("mergeNeural", () => {
  it("정확 매칭이 있으면 원격을 통째로 버린다", () => {
    /*
     * 사전이 확실하다고 말한 것을 원격 유사도로 다시 흔들지 않는다.
     * `DECISIVE`가 로컬에서 하던 판단과 같은 판단이고, 같은 이유다.
     */
    const merged = mergeNeural(
      [local("transfer.now", 1, "exact", "이체")],
      [{ menuId: "inquiry.balance", score: 0.99 }],
      SETTINGS,
      KNOWN,
      "이체",
    );

    expect(merged.map((c) => c.menuId)).toEqual(["transfer.now"]);
  });

  it("로컬에 아예 없던 메뉴를 데려온다 — 이 마일스톤의 존재 이유다", () => {
    // "돈 보내다"와 "이체"는 글자가 하나도 안 겹친다. n-gram은 0점을 준다.
    const merged = mergeNeural([], [{ menuId: "transfer.now", score: 0.9 }], SETTINGS, KNOWN, "돈보내다");

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ menuId: "transfer.now", matchedBy: "neural" });
    expect(merged[0]!.score).toBeGreaterThan(0);
  });

  it("근거로 보여 줄 말은 질의 자신이다 — 지어낸 표현을 넣지 않는다", () => {
    /*
     * `matchedTerm`은 화면이 "이거 말씀하신 건가요"의 근거로 쓴다. 원격이 준 것은
     * id와 점수뿐이라 보여 줄 표현이 없고, 없는 것을 지어내면 사용자가 자기가 하지도
     * 않은 말을 자기 말로 읽는다.
     */
    const merged = mergeNeural([], [{ menuId: "transfer.now", score: 0.9 }], SETTINGS, KNOWN, "돈보내다");

    expect(merged[0]!.matchedTerm).toBe("돈보내다");
  });

  it("같은 메뉴면 높은 쪽을 남긴다", () => {
    const merged = mergeNeural(
      [local("transfer.now", 0.5, "phonetic")],
      [{ menuId: "transfer.now", score: 0.92 }],
      SETTINGS,
      KNOWN,
      "돈보내다",
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]!.matchedBy).toBe("neural");
    expect(merged[0]!.score).toBeCloseTo(0.85);
  });

  it("동점이면 사람이 붙인 동의어가 이긴다", () => {
    /*
     * 불변 규칙 10의 근거를 점수 체계로 지킨다 — 실측에서 사람이 쓴 동의어는 80%,
     * 모델이 만든 것은 27%였다. 같은 점수라면 사람 쪽이 더 나은 내기다.
     */
    const merged = mergeNeural(
      [local("transfer.now", 0.85, "synonym", "송금")],
      [{ menuId: "transfer.now", score: 1 }],
      SETTINGS,
      KNOWN,
      "돈보내다",
    );

    expect(merged[0]!.matchedBy).toBe("synonym");
    expect(merged[0]!.matchedTerm).toBe("송금");
  });

  it("카탈로그에 없는 id는 버린다 — 서버가 옛 벡터를 들고 있을 수 있다", () => {
    /*
     * 벡터는 빌드 타임 산출물이라 카탈로그보다 오래됐을 수 있다. 없는 메뉴를 후보로
     * 올리면 화면이 열 수 없는 것을 제시한다 — 고령 사용자에게 가장 나쁜 종류의 막다른 길이다.
     */
    const merged = mergeNeural([], [{ menuId: "사라진메뉴", score: 0.99 }], SETTINGS, KNOWN, "돈보내다");

    expect(merged).toEqual([]);
  });

  it("바닥에 걸린 것은 후보가 되지 않는다", () => {
    const merged = mergeNeural([], [{ menuId: "transfer.now", score: 0.6 }], SETTINGS, KNOWN, "날씨어때");

    expect(merged).toEqual([]);
  });

  it("maxMatches를 넘는 원격 후보는 자른다", () => {
    const remote = [
      { menuId: "transfer.now", score: 0.95 },
      { menuId: "inquiry.balance", score: 0.9 },
      { menuId: "transfer.auto", score: 0.85 },
    ];
    const merged = mergeNeural([], remote, { ...SETTINGS, maxMatches: 2 }, KNOWN, "돈보내다");

    expect(merged.map((c) => c.menuId)).toEqual(["transfer.now", "inquiry.balance"]);
  });

  it("점수가 높은 순으로 낸다", () => {
    const merged = mergeNeural(
      [local("inquiry.balance", 0.5, "phonetic")],
      [
        { menuId: "transfer.auto", score: 0.8 },
        { menuId: "transfer.now", score: 0.92 },
      ],
      SETTINGS,
      KNOWN,
      "돈보내다",
    );

    expect(merged.map((c) => c.menuId)).toEqual([
      "transfer.now",
      "inquiry.balance",
      "transfer.auto",
    ]);
  });

  it("원격이 빈손이면 로컬 그대로다", () => {
    // 서버가 살아 있지만 아무것도 못 찾은 경우. 로컬 결과를 흔들 이유가 없다.
    const pool = [local("transfer.now", 0.5, "phonetic")];

    expect(mergeNeural(pool, [], SETTINGS, KNOWN, "돈보내다")).toEqual(pool);
  });

  it("같은 입력은 항상 같은 순서를 낸다", () => {
    const run = () =>
      mergeNeural(
        [local("inquiry.balance", 0.8, "synonym")],
        [
          { menuId: "transfer.now", score: 0.9 },
          { menuId: "transfer.auto", score: 0.9 },
        ],
        SETTINGS,
        KNOWN,
        "돈보내다",
      );

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

/**
 * 픽스처가 규칙을 들고 있다.
 *
 * <p>AGENTS.md: "검색 시나리오는 `packages/core/fixtures/*.json`에 <b>입력→기대 출력</b>
 * 형태로 둔다. 언어 포팅 시 동등성 검증에 재사용한다." 판단을 전부 순수 동기 함수에
 * 몰아넣은 이유가 이것이다 — 비동기 껍데기는 이렇게 잴 수 없다.
 */
describe("fixtures/neural-merge.json", () => {
  const fixture = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../fixtures/neural-merge.json"),
      "utf8",
    ),
  ) as {
    settings: NeuralSettings;
    known: string[];
    cases: {
      name: string;
      query: string;
      local: SearchCandidate[];
      remote: { menuId: string; score: number }[];
      expect: SearchCandidate[];
    }[];
  };

  const known = new Set<MenuId>(fixture.known);

  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const merged = mergeNeural(
        testCase.local,
        testCase.remote,
        fixture.settings,
        known,
        testCase.query,
      );

      // 점수는 부동소수라 자릿수를 맞춰 비교한다. 순서와 단계는 정확히 같아야 한다.
      expect(merged.map((c) => ({ ...c, score: Number(c.score.toFixed(4)) }))).toEqual(
        testCase.expect.map((c) => ({ ...c, score: Number(c.score.toFixed(4)) })),
      );
    });
  }
});

/**
 * 재순위 점수는 **따로 보정한다** (M11 하이브리드).
 *
 * <p>회수 곡선이 재순위를 가리켰다 — recall@1 12.4%인데 recall@20이 50.9%다.
 * 찾긴 찾았는데 순위를 못 매긴다.
 *
 * <p>그런데 교차 인코더의 로짓은 코사인과 <b>자가 완전히 다르다</b>. 코사인은 0.6~0.9에
 * 몰려 있고 로짓은 -10~+2로 벌어진다. 같은 `scoreFloor`로 옮기면 전부 0이 되거나 전부
 * 1이 된다. <b>다른 자를 쓰는 두 점수에는 두 개의 보정이 필요하다.</b>
 */
describe("재순위 점수 보정", () => {
  const withRerank: NeuralSettings = {
    ...SETTINGS,
    rerankFloor: -2,
    rerankCeiling: 1,
  };

  it("재순위 점수가 있으면 그것으로 보정한다", () => {
    /*
     * 코사인은 0.75(바닥 0.72 바로 위, 거의 0점)인데 재순위가 +1을 줬다.
     * 재순위를 믿는 것이 이 단계의 요점이므로 높은 점수가 나와야 한다.
     */
    const merged = mergeNeural(
      [],
      [{ menuId: "transfer.now", score: 0.75, rerankScore: 1 }],
      withRerank,
      KNOWN,
      "돈보내다",
    );

    expect(merged[0]!.score).toBeCloseTo(0.85);
  });

  it("재순위가 낮게 보면 후보에서 빠진다", () => {
    // 코사인이 높아도(0.92) 교차 인코더가 아니라고 하면 아닌 것이다.
    const merged = mergeNeural(
      [],
      [{ menuId: "transfer.now", score: 0.92, rerankScore: -9 }],
      withRerank,
      KNOWN,
      "돈보내다",
    );

    expect(merged).toEqual([]);
  });

  it("재순위 점수가 없으면 검색 점수로 보정한다 — 회귀 없음", () => {
    const merged = mergeNeural(
      [],
      [{ menuId: "transfer.now", score: 0.92 }],
      withRerank,
      KNOWN,
      "돈보내다",
    );

    expect(merged[0]!.score).toBeCloseTo(0.85);
  });

  it("재순위 보정이 설정되지 않았으면 검색 점수를 쓴다", () => {
    // 재순위를 안 켠 호스트에서 로짓이 섞여 들어와도 조용히 이상해지지 않는다.
    const merged = mergeNeural(
      [],
      [{ menuId: "transfer.now", score: 0.92, rerankScore: 1 }],
      SETTINGS,
      KNOWN,
      "돈보내다",
    );

    expect(merged[0]!.score).toBeCloseTo(0.85);
  });
});
