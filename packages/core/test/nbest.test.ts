import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type MinUIConfig } from "../src/config.js";
import { MenuIndex } from "../src/search/MenuIndex.js";
import { NgramTfIdfProvider } from "../src/search/NgramTfIdfProvider.js";
import { SearchPipeline, type Hypothesis } from "../src/search/SearchPipeline.js";
import type { MenuCatalog } from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const CATALOG = JSON.parse(
  readFileSync(join(FIXTURES, "menus.json"), "utf8"),
) as MenuCatalog;

const ON: MinUIConfig = {
  ...DEFAULT_CONFIG,
  search: {
    ...DEFAULT_CONFIG.search,
    nbest: { ...DEFAULT_CONFIG.search.nbest, enabled: true },
  },
};

/*
 * **기본값에 기대지 않는다.** 2026-09-05에 `nbest.enabled`가 기본 `true`가 되면서
 * 이 파일이 깨졌다 — 스위치가 꺼진 상태를 재려면 그 상태를 직접 만들어야 한다.
 */
const OFF: MinUIConfig = {
  ...DEFAULT_CONFIG,
  search: {
    ...DEFAULT_CONFIG.search,
    nbest: { ...DEFAULT_CONFIG.search.nbest, enabled: false },
  },
};

function makePipeline(config = DEFAULT_CONFIG) {
  const index = new MenuIndex(CATALOG);
  return new SearchPipeline(index, config, NgramTfIdfProvider.build(index.documents()));
}

const off = makePipeline(OFF);
const on = makePipeline(ON);

function say(text: string, ...rest: string[]): Hypothesis[] {
  return [text, ...rest].map((value) => ({ text: value }));
}

function topOf(pipeline: SearchPipeline, hypotheses: Hypothesis[]): string | null {
  const result = pipeline.searchHypotheses(hypotheses);
  return result.status === "ok" ? result.candidates[0]!.menuId : null;
}

describe("N-best — 인식 대안을 함께 본다 (M21)", () => {
  it("대안이 하나면 지금까지의 검색과 같다", () => {
    for (const query of ["계좌 이체", "떼가는 거", "돈 보내기", "날씨 어때"]) {
      expect(on.searchHypotheses(say(query))).toEqual(on.search(query));
    }
  });

  it("꺼 두면 대안이 있어도 1순위만 본다 — 스위치가 실제로 가른다", () => {
    // 1순위가 엉뚱해도 2순위가 정답인 상황.
    expect(topOf(off, say("날씨 어때", "계좌 이체"))).toBe(topOf(off, say("날씨 어때")));
  });

  it("1순위가 헛짚어도 대안에 있으면 찾아낸다", () => {
    expect(topOf(on, say("날씨 어때", "계좌 이체"))).toBe("transfer.account");
  });

  it("어느 대안에서든 정확 매칭이 나오면 그것이 답이다", () => {
    const result = on.searchHypotheses(say("계좌 이쳬", "계좌 이체"));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidates[0]!.matchedBy).toBe("exact");
    expect(result.candidates[0]!.menuId).toBe("transfer.account");
  });

  it("뒤 순위는 감점되어 1순위를 동점으로 밀어내지 못한다", () => {
    const first = on.searchHypotheses(say("계좌 이체", "자동이체"));
    const flipped = on.searchHypotheses(say("자동이체", "계좌 이체"));
    expect(first.status).toBe("ok");
    expect(flipped.status).toBe("ok");
    if (first.status !== "ok" || flipped.status !== "ok") return;
    expect(first.candidates[0]!.menuId).toBe("transfer.account");
    expect(flipped.candidates[0]!.menuId).toBe("transfer.auto");
  });

  it("대안을 다 봐도 못 좁히면 되묻는다 — 막다른 길을 만들지 않는다", () => {
    const result = on.searchHypotheses(say("날씨 어때", "택시 불러줘"));
    expect(result.status).toBe("unclear");
    if (result.status !== "unclear") return;
    expect(result.choices.length).toBeGreaterThan(0);
  });

  it("되묻기가 돌려주는 질의는 1순위 가설이다 — 사용자가 말한 것으로 보인다", () => {
    const result = on.searchHypotheses(say("날씨 어때", "택시 불러줘"));
    expect(result.query).toBe("날씨 어때");
  });

  it("설정한 개수까지만 본다", () => {
    const capped = makePipeline({
      ...ON,
      search: { ...ON.search, nbest: { ...ON.search.nbest, maxHypotheses: 1 } },
    });
    expect(topOf(capped, say("날씨 어때", "계좌 이체"))).toBe(topOf(off, say("날씨 어때")));
  });

  it("빈 가설은 건너뛴다", () => {
    expect(topOf(on, say("", "계좌 이체"))).toBe("transfer.account");
  });

  it("가설이 하나도 쓸 만하지 않으면 되묻는다", () => {
    expect(on.searchHypotheses(say("", "   ")).status).toBe("unclear");
  });
});
