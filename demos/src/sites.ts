import type { ColdStartPresets, MenuCatalog } from "@minui/core";
import kebhana from "./catalogs/kebhana.json" with { type: "json" };
import kbsec from "./catalogs/kbsec.json" with { type: "json" };
import kbstar from "./catalogs/kbstar.json" with { type: "json" };
import miraeasset from "./catalogs/miraeasset.json" with { type: "json" };
import provenance from "./catalogs/provenance.json" with { type: "json" };
import shinhan from "./catalogs/shinhan.json" with { type: "json" };

/**
 * 이식 대상 다섯 곳 — 그중 셋을 띄운다.
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
  /**
   * 카탈로그·동의어·벡터 파일이 쓰는 이름. **`slug`와 다르다.**
   *
   * <p>`slug`는 주소에 붙는 이름이고(`/hana`), 이것은 수집 원본이 저장된 이름이다
   * (`kebhana.json`). 둘을 하나로 합칠 수도 있었지만, 주소를 바꾸면 수집 원본과 벤치마크
   * 픽스처가 함께 끊어진다 — 그래서 갈라 두고 <b>여기 한 곳에만</b> 대응을 적는다.
   */
  catalogId: string;
  presets: ColdStartPresets;
  /** 수집 출처. 화면에 밝혀 둔다. */
  source: string;
}

/**
 * **언제 긁어 온 것인가.**
 *
 * <p>화면에 날짜를 붙이는 이유는, 붙이지 않으면 이 목록이 <b>그 금융사의 현재 메뉴</b>로
 * 읽히기 때문이다. 남의 사이트는 예고 없이 바뀌고 이 저장소는 그때마다 따라가지 않는다.
 * 여기 있는 것은 이식이 되는지 확인하려고 어느 날 떠 놓은 사본이다.
 *
 * <p>수집 원본이 적어 둔 값을 빌더가 `provenance.json`으로 흘려보낸 것을 그대로 읽는다 —
 * 사람이 따로 적으면 카탈로그만 다시 굽고 날짜는 옛날 것이 남는다.
 */
export function capturedOn(catalogId: string): string | null {
  const at = provenance.sites[catalogId as keyof typeof provenance.sites]?.capturedAt;
  if (!at) return null;
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? null
    : `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/** 온보딩 프리셋. 실제 카탈로그의 id를 골라 넣는다. */
function presets(inquiry: string[], transfer: string[], invest: string[]): ColdStartPresets {
  return { inquiry, transfer, invest };
}

/**
 * 화면에 띄우는 곳. 실제 서비스 대상이다.
 *
 * <p>KB국민은행과 미래에셋증권은 여기 없지만 <b>지우지 않았다</b> — `COLD_SITES`에 그대로
 * 있고 카탈로그·수집 원본·동의어도 전부 남아 있다. 벤치마크와 규모 측정은 다섯 곳을
 * 모두 돌린다. 두 곳을 지우면 "네 사이트에서 이식 비용 0줄"이라는 M6의 측정이
 * 재현 불가능해지고, 되돌리는 데 재수집이 필요해진다.
 */
export const SITES: SiteMeta[] = [
  {
    slug: "shinhan",
    name: "신한은행",
    kind: "은행",
    accent: "#0046a0",
    catalog: shinhan as MenuCatalog,
    catalogId: "shinhan",
    source: "shinhan.com 전체메뉴 (개인·기업·퇴직연금·자산관리·은행소개)",
    presets: presets(
      [
        "shinhan.개인-조회-전체계좌",
        "shinhan.개인-조회-예금-신탁",
        "shinhan.개인-공과금-법원-나의-공과금-조회-납부",
        "shinhan.개인-금융상품-환전",
      ],
      [
        "shinhan.개인-이체-당행-다른기관이체",
        "shinhan.개인-이체-자동이체-등록",
        "shinhan.개인-조회-전체계좌",
        "shinhan.개인-이체-자동이체-조회-변경-취소",
      ],
      [
        "shinhan.개인-조회-예금-신탁",
        "shinhan.개인-금융상품-대출계좌조회",
        "shinhan.개인-조회-전체계좌",
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
    catalogId: "kbsec",
    source: "kbsec.com 전체메뉴",
    presets: presets(
      ["kbsec.m02010002", "kbsec.m02010004", "kbsec.m01060018", "kbsec.m02040023"],
      ["kbsec.m02020002", "kbsec.m01060018", "kbsec.m02010002", "kbsec.m02010004"],
      ["kbsec.m01010001", "kbsec.m01010029", "kbsec.m02010004", "kbsec.m02010002"],
    ),
  },

  {
    slug: "hana",
    name: "하나은행",
    kind: "은행",
    // 브랜드 청록 #008485는 흰 글자와 4.53:1로 아슬아슬하다. 한 단계 낮춰 6.07:1로 쓴다.
    accent: "#006e6f",
    catalog: kebhana as MenuCatalog,
    catalogId: "kebhana",
    source: "kebhana.com 전체메뉴",
    presets: presets(
      ["kebhana.102689", "kebhana.102692", "kebhana.57949", "kebhana.1501"],
      ["kebhana.57915", "kebhana.57931", "kebhana.102689", "kebhana.102692"],
      ["kebhana.58030", "kebhana.21101", "kebhana.102689", "kebhana.102692"],
    ),
  },
];

/**
 * 띄우지 않는 곳. **데이터는 그대로 둔다.**
 *
 * <p>서비스 대상에서 빠졌을 뿐 카탈로그도 동의어도 살아 있다. 벤치마크·규모 측정은
 * 여전히 다섯 곳을 돌리고, 다시 켜려면 이 배열에서 SITES로 옮기기만 하면 된다.
 */
export const COLD_SITES: SiteMeta[] = [
  {
    slug: "kb",
    name: "KB국민은행",
    kind: "은행",
    accent: "#5a4a1f",
    catalog: kbstar as MenuCatalog,
    catalogId: "kbstar",
    source: "kbstar.com 개인뱅킹 전체메뉴",
    presets: presets(
      ["kbstar.C055066", "kbstar.C016536", "kbstar.C016607", "kbstar.C101333"],
      ["kbstar.C060833", "kbstar.C018401", "kbstar.C055066", "kbstar.C016536"],
      ["kbstar.C016613", "kbstar.C103429", "kbstar.C055066", "kbstar.C016536"],
    ),
  },
  {
    slug: "miraeasset",
    name: "미래에셋증권",
    kind: "증권",
    // 브랜드색 #d8500f는 흰 글자와 4.14:1이라 작은 글자에 모자란다. 5.53:1로 낮춘다.
    accent: "#b8410a",
    catalog: miraeasset as MenuCatalog,
    catalogId: "miraeasset",
    source: "securities.miraeasset.com 전체메뉴",
    presets: presets(
      [
        "miraeasset.금융상품-펀드-펀드잔고",
        "miraeasset.금융상품-펀드-기준가-수익률조회",
        "miraeasset.연금자산-MY개인연금-개인연금-잔고",
        "miraeasset.뱅킹-대출-청약-이체-이체계좌-정보조회",
      ],
      [
        "miraeasset.뱅킹-대출-청약-이체-간편이체",
        "miraeasset.뱅킹-대출-청약-이체-이체내역조회",
        "miraeasset.금융상품-펀드-펀드잔고",
        "miraeasset.연금자산-MY개인연금-개인연금-잔고",
      ],
      [
        "miraeasset.금융상품-펀드-펀드검색",
        "miraeasset.금융상품-펀드-기준가-수익률조회",
        "miraeasset.연금자산-MY개인연금-개인연금-잔고",
        "miraeasset.금융상품-펀드-펀드잔고",
      ],
    ),
  },];

/** 데이터가 있는 전부. 직접 주소를 친 경우에도 찾을 수 있게 한다. */
export const ALL_SITES: SiteMeta[] = [...SITES, ...COLD_SITES];

export function findSite(slug: string): SiteMeta | undefined {
  return ALL_SITES.find((site) => site.slug === slug);
}
