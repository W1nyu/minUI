import type { ColdStartPresets, MenuCatalog } from "@minui/core";

/**
 * 첫 화면에 무엇을 놓을 것인가 — **카탈로그 앞에서부터 넉 장.**
 *
 * <p>여기는 LLM에게 물어보던 자리였다. 두 가지 이유로 그만뒀다.
 *
 * <p><b>① 품질이 좋지 않았다.</b> 하나은행에서 `해지계좌 조회`·`세금우대한도조회`를,
 * KB증권에서 `랩잔고조회`를 첫 화면에 올렸다 — 70대가 은행 앱을 열자마자 볼 것이 아니다.
 * 호출 한 번으로 600개 중 넉 장을 고르는 판단의 한계다.
 *
 * <p><b>② 첫 화면은 오래 가는 결정이 아니다.</b> 사용 기록이 쌓이면 랭킹이 밀어내고
 * (기획안 §8.1), 마음에 안 들면 사용자가 전체 메뉴에서 직접 고정한다(F3). 며칠이면
 * 사라질 배치를 위해 모든 이식에 LLM 호출을 매다는 것은 값이 맞지 않는다.
 *
 * <p>그래서 <b>짐작을 잘하려 하지 않고 짐작을 적게 한다.</b> 카탈로그 순서는 그 사이트가
 * 스스로 정한 순서라, 아무 근거 없는 순서보다는 낫다.
 *
 * <p>세 부류(inquiry·transfer·invest)에 같은 넉 장을 준다. 구분할 근거가 없는데
 * 구분한 척하면 온보딩 두 문항이 하는 일이 없으면서 있는 것처럼 보인다.
 */
export function firstCards(catalog: MenuCatalog, count = 4): ColdStartPresets {
  const cards = catalog
    .filter((menu) => menu.cardable !== false)
    .slice(0, count)
    .map((menu) => menu.id);

  return { inquiry: cards, transfer: cards, invest: cards };
}
