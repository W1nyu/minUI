import { describe, expect, it } from "vitest";
import { menuDocument } from "../src/document.js";

/**
 * 메뉴 하나를 **무슨 글로** 벡터화할 것인가.
 *
 * <p>여기가 M11에서 규칙 10("동의어를 미리 붙이지 않는다")과 가장 가깝게 스치는 자리다.
 * 실측이 기록한 실패는 <b>모델이 만든 표현을 색인의 term에 얹은 것</b>이었다 —
 * 사람 것만 85%가 전 메뉴에 LLM 동의어를 얹으니 67%로 떨어졌다.
 *
 * <p>여기서 하는 일은 다르다. term을 늘리는 것이 아니라 <b>한 메뉴를 한 벡터로 만드는
 * 데 쓸 글</b>을 고르는 것이고, 벡터는 메뉴당 하나뿐이라 서로를 밀어낼 자리가 없다.
 * 그래도 무엇을 넣을지는 <b>재서</b> 정한다 — 특히 `hint`는 모델이 쓴 것이라 그대로
 * 넣으면 같은 함정에 발을 걸칠 수 있다. 기본은 빼고, `tune:neural`이 넣고 빼고를 잰다.
 */
describe("menuDocument", () => {
  it("라벨이 언제나 들어간다", () => {
    expect(menuDocument({ label: "계좌이체" })).toContain("계좌이체");
  });

  it("사람이 붙인 동의어를 함께 넣는다", () => {
    // 사람 것은 §16이 재 둔 대로 가장 좋은 재료다 (사람 80% vs 모델 27%).
    const doc = menuDocument({ label: "계좌이체", synonyms: ["송금", "돈 보내기"] });

    expect(doc).toContain("송금");
    expect(doc).toContain("돈 보내기");
  });

  it("갈래를 함께 넣는다 — 같은 이름이 여러 곳에 있다", () => {
    /*
     * 신한은행에만 `조회`라는 이름이 여러 갈래 아래 있다. 갈래가 없으면 그 벡터들이
     * 서로 구분되지 않고, 원격이 엉뚱한 `조회`를 데려온다.
     */
    const doc = menuDocument({ label: "조회", path: ["개인뱅킹", "예금"] });

    expect(doc).toContain("예금");
  });

  it("**뜻풀이는 기본으로 넣지 않는다**", () => {
    /*
     * 모델이 쓴 글이다. 넣는 것이 이득인지는 재기 전에 알 수 없고, 재지 않고 넣는 것이
     * 85%→67%를 만든 그 동작이다. 켜고 끄고를 `tune:neural`이 재고 나서 정한다.
     */
    const doc = menuDocument({ label: "관세", hint: "수입 물품에 붙는 세금" });

    expect(doc).not.toContain("수입 물품");
  });

  it("뜻풀이를 켜면 들어간다", () => {
    const doc = menuDocument(
      { label: "관세", hint: "수입 물품에 붙는 세금" },
      { includeHint: true },
    );

    expect(doc).toContain("수입 물품");
  });

  it("같은 말이 두 번 들어가지 않는다", () => {
    // 라벨과 동의어가 겹치는 메뉴가 실재한다. 두 번 넣으면 그 말의 무게만 커진다.
    const doc = menuDocument({ label: "이체", synonyms: ["이체", "송금"] });

    expect(doc.match(/이체/g)).toHaveLength(1);
  });

  it("빈 것들은 걸러진다", () => {
    const doc = menuDocument({ label: "이체", synonyms: ["", "  "], path: [""] });

    expect(doc.trim()).toBe("이체");
  });

  it("같은 입력은 늘 같은 글을 낸다", () => {
    const menu = { label: "이체", synonyms: ["송금"], path: ["개인뱅킹"] };

    expect(menuDocument(menu)).toBe(menuDocument(menu));
  });
});
