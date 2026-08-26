import { MinUIEngine, MemoryStorageAdapter } from "@minui/core";
import { beforeEach, describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.js";

/**
 * 되묻기가 **답으로 가는 문**을 내주는가.
 *
 * <p>발표용 고정 시나리오("삼촌에게 3만 원 보내기")를 리허설하다 찾은 결함이다.
 * `삼촌한테 3만원 보내줘`가 되묻기로 떨어지는 것까지는 기획안 §12가 이미 알려진 한계로
 * 적어 둔 것이지만(`"보내줘"`만으로는 약하고 한글 금액이 붙으면 더 나빠진다),
 * <b>선택지에 `계좌 이체`가 아예 없었다.</b> 사용자가 갈 수 있는 곳이 "특수 이체"와
 * "자동·예약" 둘뿐이었다.
 *
 * <p>원인은 검색이 아니라 카탈로그다. `bestSplit`은 그 깊이에 갈래가 없는 메뉴를
 * 나눔에서 뺀다(`packages/core/src/search/reprompt.ts`) — 주석에 그렇게 적혀 있다.
 * `이체` 아래에서 일부만 2단 갈래를 갖고 있으면, 2단으로 가르는 순간 <b>1단에만 있는
 * 메뉴가 통째로 사라진다.</b> 그리고 그 나눔이 더 고르게 갈리므로 이깁니다.
 *
 * <p>그래서 여기서 두 가지를 잰다. 아래 불변식은 카탈로그만 보면 확인되므로
 * 같은 실수가 다시 들어오면 화면을 거치지 않고 바로 걸린다.
 */

const CATEGORIES = [...new Set(CATALOG.map((menu) => menu.category))];

describe("카탈로그 — 갈래는 전부 같은 깊이여야 한다", () => {
  it.each(CATEGORIES)("%s 아래에서는 2단 갈래가 전부 있거나 전부 없다", (category) => {
    const menus = CATALOG.filter((menu) => menu.category === category);
    const withDepth2 = menus.filter((menu) => (menu.path?.length ?? 0) >= 2);

    /*
     * 반쪽만 2단이면 `bestSplit`이 2단으로 가를 때 1단짜리가 선택지에서 빠진다.
     * 전부 1단이면 그 갈래는 2단으로 안 갈리고 1단 나눔에 온전히 참여한다 —
     * 그것은 안전하다. 위험한 것은 **섞여 있는 것**뿐이다.
     */
    expect(
      withDepth2.length === 0 || withDepth2.length === menus.length,
      `${category}: ${menus.length}개 중 ${withDepth2.length}개만 2단 갈래가 있다. ` +
        `2단이 없는 것: ${menus
          .filter((menu) => (menu.path?.length ?? 0) < 2)
          .map((menu) => menu.label)
          .join(", ")}`,
    ).toBe(true);
  });
});

describe("되묻기 — 막다른 길이 없다", () => {
  let engine: MinUIEngine;

  beforeEach(async () => {
    engine = await MinUIEngine.create({
      catalog: CATALOG,
      storage: new MemoryStorageAdapter(),
    });
  });

  /**
   * 이 말로 **닿을 수 있는 메뉴 전부**.
   *
   * <p>세 갈래를 모두 본다 — 바로 열리거나(`open`), 후보로 고르게 하거나(`choose`),
   * 되묻거나(`reprompt`). 되묻기의 선택지는 그 자체가 메뉴가 아니라 갈래이므로
   * 그 갈래가 품은 메뉴들을 편다.
   */
  function reachable(query: string): string[] {
    const action = engine.voiceAction(query);
    if (action.kind === "open") return [action.menuId];
    if (action.kind === "choose") return action.candidates.map((c) => c.menuId);
    return action.choices.flatMap((choice) => choice.menuIds);
  }

  it("돈을 보내려는 말은 계좌 이체로 가는 문을 준다 ★", () => {
    /*
     * 1순위로 바로 찾는 것까지는 요구하지 않는다 — 기획안 §12가 "`보내줘`는 약하다"고
     * 이미 적어 뒀고, 목적어 없는 동사를 동의어로 넣는 것은 벤치마크에서 해로웠다.
     * 여기서 요구하는 것은 **갈 수 있는가**다.
     */
    expect(reachable("삼촌한테 3만원 보내줘")).toContain("transfer.account");
  });

  it.each([
    ["김미영한테 삼십만원 보내줘", "transfer.account"],
    ["돈 부쳐야 해", "transfer.account"],
    ["매달 나가는 거 그만", "transfer.auto"],
  ])("%s → %s에 닿을 수 있다", (query, expected) => {
    expect(reachable(query)).toContain(expected);
  });
});
