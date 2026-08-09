import type {
  ColdStartPresets,
  ColdStartProfile,
  MenuCatalog,
  MenuId,
} from "./types.js";

/**
 * 콜드 스타트 (기획안 F5).
 *
 * 사용 기록이 없으면 랭킹을 계산할 재료가 없다. 온보딩 2문항으로 초기 세트를 정하고,
 * 이후에는 별도의 "전환 로직" 없이 히스테리시스가 하루 한 장씩 실제 사용 기반 카드로
 * 바꿔 나간다. 특정 시점에 화면을 통째로 갈아엎지 않는 것이 "자연스러운 전환"의 실제 구현이다.
 */

/** 온보딩을 건너뛴 사용자의 기본값. 기획안 F5가 지정한 "조회 중심". */
export const DEFAULT_PROFILE: ColdStartProfile = {
  intent: "inquiry",
  textScale: "normal",
};

/**
 * 초기 카드 구성.
 *
 * 프리셋은 호스트 앱이 자기 메뉴 ID로 정의한다. 엔진이 카테고리 문자열을 보고
 * 추측하지 않는 이유는, 카테고리 이름이 호스트마다 다른 임의의 문자열이기 때문이다.
 * 프리셋이 없거나 모자라면 카탈로그 순서로 채운다 — 호스트가 중요한 것을 앞에 둔다는
 * 가정은 어느 앱에서나 대체로 성립한다.
 */
export function coldStartCards(
  catalog: MenuCatalog,
  profile: ColdStartProfile,
  count: number,
  presets?: ColdStartPresets,
): MenuId[] {
  const cardable = catalog.filter((m) => m.cardable !== false);
  const available = new Set(cardable.map((m) => m.id));

  const picked: MenuId[] = [];
  for (const menuId of presets?.[profile.intent] ?? []) {
    if (picked.length >= count) break;
    if (available.has(menuId) && !picked.includes(menuId)) picked.push(menuId);
  }

  for (const menu of cardable) {
    if (picked.length >= count) break;
    if (!picked.includes(menu.id)) picked.push(menu.id);
  }

  return picked;
}

/**
 * 아직 개인화를 시작하기에 근거가 부족한가.
 *
 * 이 구간에서는 재배치를 아예 막는다. 설치 이틀째의 잘못 누른 탭 한 번이
 * 온보딩으로 정한 카드를 밀어내면, 사용자 입장에서는 이유를 알 수 없는 변화다.
 */
export function isColdStart(totalVisits: number, visitsUntilPersonalized: number): boolean {
  return totalVisits < visitsUntilPersonalized;
}
