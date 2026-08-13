import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import { MenuIndex } from "../src/search/MenuIndex.js";
import { NgramTfIdfProvider } from "../src/search/NgramTfIdfProvider.js";
import { SearchPipeline } from "../src/search/SearchPipeline.js";
import type { MenuCatalog } from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const CATALOG = JSON.parse(
  readFileSync(join(FIXTURES, "menus.json"), "utf8"),
) as MenuCatalog;

function makePipeline(config = DEFAULT_CONFIG, catalog = CATALOG) {
  const index = new MenuIndex(catalog);
  const embedding = NgramTfIdfProvider.build(index.documents());
  return new SearchPipeline(index, config, embedding);
}

const pipeline = makePipeline();

function topId(query: string): string | null {
  const result = pipeline.search(query);
  return result.status === "ok" ? result.candidates[0]!.menuId : null;
}

describe("② 동의어 — 확실한 것부터", () => {
  it("메뉴 이름을 그대로 말하면 그 메뉴다", () => {
    expect(topId("계좌 이체")).toBe("transfer.account");
  });

  it("등록된 구어 표현을 알아듣는다", () => {
    expect(topId("돈 보내기")).toBe("transfer.account");
    expect(topId("떼가는 거")).toBe("transfer.auto");
  });

  it("정확 매칭이 있으면 유사도 점수로 흔들리지 않는다", () => {
    const result = pipeline.search("잔액 보기");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidates[0]!.matchedBy).toBe("exact");
    expect(result.candidates[0]!.score).toBe(1);
  });

  it("긴 문장 안에 동의어가 들어 있어도 찾는다", () => {
    expect(topId("자동이체 안 나가게 해야 하는데")).toBe("transfer.auto");
  });

  it("조사와 어미가 붙어도 찾는다", () => {
    expect(topId("이체를 해야 하는데")).toBe("transfer.account");
  });
});

describe("④ 자모 보정 — STT 오인식 복구 (기획안 §8.3)", () => {
  it("모음 하나가 틀린 인식을 복구한다", () => {
    // "이체"를 "이제"로 받는 전형적인 오인식
    expect(topId("이제해줘")).toBe("transfer.account");
  });

  it("받침 하나가 틀린 인식을 복구한다", () => {
    expect(topId("송그")).toBe("transfer.account");
  });

  it("복구했다는 사실이 결과에 남는다", () => {
    const result = pipeline.search("이제해줘");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidates[0]!.matchedBy).toBe("phonetic");
  });

  it("자모가 우연히 스친 정도로는 후보를 만들지 않는다", () => {
    // 아무 관계 없는 말이 짧은 메뉴 이름에 걸려 들어오면 안 된다.
    const result = pipeline.search("오늘 날씨 어때");
    expect(result.status).toBe("unclear");
  });
});

describe("⑤ 임계치와 되묻기 (기획안 §9.2)", () => {
  it("알아듣지 못하면 후보를 내지 않는다", () => {
    expect(pipeline.search("asdfgh").status).toBe("unclear");
  });

  it("빈 입력도 되묻는다", () => {
    expect(pipeline.search("   ").status).toBe("unclear");
  });

  it("열린 질문 대신 선택지를 준다", () => {
    const result = pipeline.search("asdfgh");
    expect(result.status).toBe("unclear");
    if (result.status !== "unclear") return;

    expect(result.choices.length).toBeGreaterThan(0);
    expect(result.prompt).toContain("중에 찾으시는 게 있나요?");
    // "무엇을 도와드릴까요" 같은 열린 질문은 고령 사용자에게 효과가 낮다.
    expect(result.prompt).not.toContain("무엇을");
  });

  it("임계치를 올리면 더 엄격해진다", () => {
    const strict = makePipeline(resolveConfig({ search: { minConfidence: 0.99 } }));
    expect(strict.search("돈 좀 부쳐야 하는데").status).toBe("unclear");
  });
});

describe("후보 제시 (기획안 F4)", () => {
  it("최대 3개까지만 준다", () => {
    const result = pipeline.search("이체");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidates.length).toBeLessThanOrEqual(
      DEFAULT_CONFIG.search.maxCandidates,
    );
  });

  it("설정으로 후보 수를 줄일 수 있다", () => {
    const single = makePipeline(resolveConfig({ search: { maxCandidates: 1 } }));
    const result = single.search("이체");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidates).toHaveLength(1);
  });

  it("같은 질의는 항상 같은 순서를 낸다", () => {
    const a = pipeline.search("보내기");
    const b = pipeline.search("보내기");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("후보에 근거가 함께 온다", () => {
    const result = pipeline.search("떼가는 거");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidates[0]!.matchedTerm.length).toBeGreaterThan(0);
  });
});

describe("색인 직렬화 — 빌드 타임 산출물", () => {
  it("JSON으로 내보내고 다시 읽어도 같은 결과다", () => {
    const index = new MenuIndex(CATALOG);
    const built = NgramTfIdfProvider.build(index.documents());
    const restored = NgramTfIdfProvider.fromJSON(
      JSON.parse(JSON.stringify(built.toJSON())),
    );

    const a = new SearchPipeline(index, DEFAULT_CONFIG, built).search("돈 부쳐야 해");
    const b = new SearchPipeline(index, DEFAULT_CONFIG, restored).search("돈 부쳐야 해");

    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("색인이 JSON 왕복 가능하다 — 다른 언어도 읽을 수 있어야 한다", () => {
    const built = NgramTfIdfProvider.build(new MenuIndex(CATALOG).documents());
    const json = built.toJSON();
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe("임베딩 없이도 동작한다", () => {
  it("Provider를 주지 않으면 동의어와 자모만으로 찾는다", () => {
    const bare = new SearchPipeline(new MenuIndex(CATALOG), DEFAULT_CONFIG);
    expect(bare.search("돈 보내기").status).toBe("ok");
  });
});

describe("동점이면 자식이 갈래를 이긴다", () => {
  /**
   * 실측에서 나온 상황 그대로다. 동의어 "환율"이 갈래 `환율`과 자식 `환율조회`에 똑같이
   * 걸려 점수가 0.810으로 같았고, 카탈로그 순서(=사이트 DOM 순서)가 갈래를 앞세웠다.
   */
  const TREE: MenuCatalog = [
    {
      id: "x.환율",
      label: "환율",
      synonyms: ["환율"],
      category: "외환",
      path: ["개인뱅킹", "외환"],
      icon: "globe",
      route: "/x/환율",
      riskLevel: "low",
    },
    {
      id: "x.환율조회",
      label: "환율조회",
      synonyms: ["환율"],
      category: "외환",
      path: ["개인뱅킹", "외환", "환율"],
      icon: "globe",
      route: "/x/환율조회",
      riskLevel: "low",
    },
  ];

  function pipeline(catalog: MenuCatalog) {
    const index = new MenuIndex(catalog);
    return new SearchPipeline(index, DEFAULT_CONFIG, NgramTfIdfProvider.build(index.documents()));
  }

  it("점수가 같으면 자식이 앞에 온다", () => {
    const result = pipeline(TREE).search("환율");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidates[0]?.menuId).toBe("x.환율조회");
    expect(result.candidates[0]?.score).toBe(result.candidates[1]?.score);
  });

  it("점수가 다르면 갈래라도 이긴다 — 감점이 아니라 동점 규칙이다", () => {
    // 갈래에만 정확 매칭되는 표현을 준다.
    const catalog: MenuCatalog = [
      { ...TREE[0]!, synonyms: ["환율", "오늘 환율"] },
      TREE[1]!,
    ];

    const result = pipeline(catalog).search("오늘 환율");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidates[0]?.menuId).toBe("x.환율");
  });

  it("계층 정보가 없는 호스트에서는 아무것도 달라지지 않는다", () => {
    const flat = TREE.map(({ path: _path, ...menu }) => menu);

    const result = pipeline(flat).search("환율");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // 동점이므로 카탈로그 순서 그대로.
    expect(result.candidates[0]?.menuId).toBe("x.환율");
    expect(result.candidates).toHaveLength(2);
  });
});
