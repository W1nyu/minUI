import { describe, expect, it } from "vitest";
import { deriveKey, isSameSite } from "../src/keys.js";

/**
 * 사다리의 각 칸이 실제 사이트에서 확인한 모양을 처리하는가.
 *
 * <p>여기 나오는 href·onclick 모양은 전부 다섯 사이트를 손으로 수집하면서 본 것이다.
 * 지어낸 예로 테스트하면 수집기가 실제 사이트에서 무엇을 만나는지 알 수 없다.
 */

const path = ["개인뱅킹", "이체"];

describe("① 쿼리 파라미터 코드 — 가장 안정적", () => {
  it("KB국민은행: ?page=<코드>", () => {
    expect(deriveKey({ href: "/quics?page=C016536&cc=b028364", path, label: "거래내역 조회" })).toBe(
      "page:C016536",
    );
  });

  it("KB증권: ?linkcd=<코드>", () => {
    expect(deriveKey({ href: "/go.able?linkcd=m02010002", path, label: "계좌별잔고조회" })).toBe(
      "linkcd:m02010002",
    );
  });

  it("절대 URL이어도 읽는다", () => {
    expect(
      deriveKey({ href: "https://obank.kbstar.com/quics?page=C060833", path, label: "계좌이체" }),
    ).toBe("page:C060833");
  });

  it("파라미터가 여럿이면 우선순위가 앞선 것을 쓴다", () => {
    expect(deriveKey({ href: "/x?cmd=go&page=C016536", path, label: "가" })).toBe("page:C016536");
  });

  it("너무 짧은 값은 코드로 보지 않는다 — 순번일 수 있다", () => {
    expect(deriveKey({ href: "/x?page=1", path, label: "가" })).toBe("path:/x");
  });
});

describe("② onclick 안의 숫자 — 하나은행", () => {
  it("goMenu('102689') 꼴", () => {
    expect(
      deriveKey({
        href: "#//HanaBank",
        onclick: "javascript:goMenu('102689'); return false;",
        path,
        label: "계좌조회",
      }),
    ).toBe("code:102689");
  });

  it("3자리 이하는 코드가 아니다", () => {
    expect(deriveKey({ href: "#", onclick: "move(12)", path, label: "가" })).toBe(
      "label:개인뱅킹/이체/가",
    );
  });
});

describe("③ 요소 id 안의 숫자", () => {
  it("depth1_img_12000", () => {
    expect(
      deriveKey({ href: "#", elementId: "depth1_img_12000", path: [], label: "조회" }),
    ).toBe("code:12000");
  });
});

describe("④ pathname", () => {
  it("페이지가 나뉜 사이트", () => {
    expect(deriveKey({ href: "/personal/transfer/account.do", path, label: "계좌이체" })).toBe(
      "path:/personal/transfer/account.do",
    );
  });

  it("해시만 있으면 경로가 아니다", () => {
    expect(deriveKey({ href: "#tab2", path, label: "가" })).toBe("label:개인뱅킹/이체/가");
  });
});

describe("⑤ 라벨 경로 — 마지막 수단", () => {
  it("신한은행: javascript:void(null)", () => {
    expect(
      deriveKey({ href: "javascript:void(null)", path: ["개인", "이체"], label: "당행/다른기관이체" }),
    ).toBe("label:개인/이체/당행/다른기관이체");
  });

  it("href가 아예 없어도 만든다", () => {
    expect(deriveKey({ path: ["금융상품"], label: "펀드검색" })).toBe("label:금융상품/펀드검색");
  });
});

describe("사다리 순서 — 위가 아래를 이긴다", () => {
  it("쿼리 코드가 있으면 onclick을 보지 않는다", () => {
    expect(
      deriveKey({ href: "/x?page=C016536", onclick: "goMenu('999999')", path, label: "가" }),
    ).toBe("page:C016536");
  });

  it("onclick 코드가 있으면 pathname을 보지 않는다", () => {
    expect(
      deriveKey({ href: "/some/path.do", onclick: "goMenu('102689')", path, label: "가" }),
    ).toBe("code:102689");
  });
});

describe("같은 사이트인가", () => {
  it("서브도메인은 같은 사이트다 — KB국민은행 개인뱅킹이 obank다", () => {
    expect(isSameSite("https://obank.kbstar.com/quics?page=C016536", "www.kbstar.com")).toBe(true);
  });

  it("제휴사·외부 링크는 뺀다", () => {
    expect(isSameSite("https://play.google.com/store/apps", "www.kbstar.com")).toBe(false);
    expect(isSameSite("https://www.instagram.com/kbbank", "www.kbstar.com")).toBe(false);
  });

  it("상대 경로와 스크립트 링크는 내부다", () => {
    expect(isSameSite("/quics?page=C016536", "www.kbstar.com")).toBe(true);
    expect(isSameSite("javascript:void(null)", "www.shinhan.com")).toBe(true);
  });
});
