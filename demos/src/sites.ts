import type { ColdStartPresets, MenuCatalog } from "@minui/core";
import kbsec from "./catalogs/kbsec.json" with { type: "json" };
import kbstar from "./catalogs/kbstar.json" with { type: "json" };
import miraeasset from "./catalogs/miraeasset.json" with { type: "json" };
import shinhan from "./catalogs/shinhan.json" with { type: "json" };

/**
 * 이식 대상 네 곳.
 *
 * <p>호스트가 제공하는 것은 카탈로그와, 온보딩 프리셋으로 쓸 메뉴 id 목록뿐이다.
 * 그 밖에 `@minui/*`에 넘기는 것은 없다 — 이 파일이 짧은 것이 이식성의 증거다.
 *
 * <p>카탈로그는 실제 사이트에서 수집한 것이라 <b>내가 고른 메뉴가 아니다.</b>
 * 미니은행 데모는 내가 엔진에 맞춰 25개를 골라 썼지만, 여기서는 사이트가 만든
 * 메뉴 체계를 그대로 받는다. 그것이 이 검증의 요지다.
 */

export interface SiteMeta {
  slug: string;
  name: string;
  kind: "은행" | "증권";
  /** 대표색. 데모 껍데기에만 쓴다 — 엔진은 색을 모른다. */
  accent: string;
  catalog: MenuCatalog;
  presets: ColdStartPresets;
  /** 수집 출처. 화면에 밝혀 둔다. */
  source: string;
}

/** 온보딩 프리셋. 실제 카탈로그의 id를 골라 넣는다. */
function presets(inquiry: string[], transfer: string[], invest: string[]): ColdStartPresets {
  return { inquiry, transfer, invest };
}

export const SITES: SiteMeta[] = [
  {
    slug: "kb",
    name: "KB국민은행",
    kind: "은행",
    accent: "#5a4a1f",
    catalog: kbstar as MenuCatalog,
    source: "kbstar.com 개인뱅킹 전체메뉴",
    presets: presets(
      ["kbstar.C016513", "kbstar.C016536", "kbstar.C016550", "kbstar.C101318"],
      ["kbstar.C060833", "kbstar.C016540", "kbstar.C016513", "kbstar.C016536"],
      ["kbstar.C016528", "kbstar.C103425", "kbstar.C016513", "kbstar.C016536"],
    ),
  },
  {
    slug: "shinhan",
    name: "신한은행",
    kind: "은행",
    accent: "#0046a0",
    catalog: shinhan as MenuCatalog,
    source: "shinhan.com 전체메뉴 (개인·기업·퇴직연금·자산관리·은행소개)",
    presets: presets(
      [
        "shinhan.개인-조회",
        "shinhan.개인-조회-예금-신탁",
        "shinhan.개인-공과금-법원",
        "shinhan.개인-금융상품-환전",
      ],
      [
        "shinhan.개인-이체",
        "shinhan.개인-이체-당행-다른기관이체",
        "shinhan.개인-조회",
        "shinhan.개인-이체-자동이체-조회-변경-취소",
      ],
      [
        "shinhan.개인-조회-예금-신탁",
        "shinhan.개인-금융상품-대출계좌조회",
        "shinhan.개인-조회",
        "shinhan.개인-조회-대출",
      ],
    ),
  },
  {
    slug: "kbsec",
    name: "KB증권",
    kind: "증권",
    accent: "#6b5a2a",
    catalog: kbsec as MenuCatalog,
    source: "kbsec.com 전체메뉴",
    presets: presets(
      ["kbsec.m02010000", "kbsec.m02010004", "kbsec.m01060018", "kbsec.m02040023"],
      ["kbsec.m02020000", "kbsec.m01060018", "kbsec.m02010000", "kbsec.m02010004"],
      ["kbsec.m01010001", "kbsec.m01110000", "kbsec.m02010004", "kbsec.m02010000"],
    ),
  },
  {
    slug: "miraeasset",
    name: "미래에셋증권",
    kind: "증권",
    accent: "#d8500f",
    catalog: miraeasset as MenuCatalog,
    source: "securities.miraeasset.com 전체메뉴",
    presets: presets(
      [
        "miraeasset.금융상품-펀드-펀드잔고",
        "miraeasset.금융상품-펀드-기준가-수익률조회",
        "miraeasset.연금자산-MY개인연금",
        "miraeasset.뱅킹-대출-청약-이체-이체계좌-정보조회",
      ],
      [
        "miraeasset.뱅킹-대출-청약-이체",
        "miraeasset.뱅킹-대출-청약-이체-간편이체",
        "miraeasset.금융상품-펀드-펀드잔고",
        "miraeasset.연금자산-MY개인연금",
      ],
      [
        "miraeasset.금융상품-펀드",
        "miraeasset.금융상품-펀드-기준가-수익률조회",
        "miraeasset.연금자산-MY개인연금",
        "miraeasset.금융상품-펀드-펀드잔고",
      ],
    ),
  },
];

export function findSite(slug: string): SiteMeta | undefined {
  return SITES.find((site) => site.slug === slug);
}
