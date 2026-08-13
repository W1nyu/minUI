/**
 * 라벨 정리 규칙. **카탈로그 빌더와 수집 회수율 측정이 같은 것을 써야 한다.**
 *
 * <p>따로 두면 이런 일이 난다 — 회수율 측정에서 KB증권이 89%로 나왔는데, 놓쳤다는 76건 중
 * 대부분이 `"펀드몰 하위메뉴"` 같은 스크린리더용 문구였다. 빌더는 그것을 어차피 지우므로
 * 카탈로그에는 애초에 들어가지 않는다. <b>정리 전 라벨로 비교하는 바람에 자동 수집이
 * 실제보다 나빠 보였다.</b> 규칙이 한 곳에 있으면 그런 어긋남이 생기지 않는다.
 */

/**
 * 수집물에 섞여 들어오는 것들.
 *
 * <p>미래에셋은 앵커 안에 `<span class="mb">로그인필요</span>` 같은 스크린리더용 배지를
 * 두는데, 그대로 두면 "이체로그인필요"가 메뉴 이름이 된다. 수집 쪽에서 걸러도 되지만
 * 여기서 하는 편이 낫다 — 재수집할 때마다 수집기를 다시 고칠 필요가 없다.
 */
export const LABEL_NOISE = [
  /로그인\s*필요$/,
  /새창\s*열기$/,
  /새\s*창$/,
  /바로가기$/,
  /\s*열기$/,
  /하위메뉴$/,
];

/** 메뉴가 아닌 것. 사이트 UI 컨트롤이 링크로 만들어져 섞여 들어온다. */
export const NOT_A_MENU = new Set([
  "검색창 열기",
  "검색창",
  "전체메뉴 열기",
  "전체메뉴",
  "전체 메뉴 보기",
  "이전",
  "다음",
  "닫기",
  "더보기",
  "TOP",
]);

export function cleanLabel(raw: string): string {
  let label = raw.replace(/\s+/g, " ").trim();
  for (const pattern of LABEL_NOISE) label = label.replace(pattern, "").trim();
  return label;
}

/**
 * 카탈로그에 들어갈 수 있는 라벨인가. 원문과 정리본 양쪽으로 본다 —
 * "검색창 열기"는 정리하면 "검색창"이 되는데 그것도 메뉴가 아니다.
 */
export function isMenuLabel(raw: string): boolean {
  const label = cleanLabel(raw);
  return label.length > 0 && !NOT_A_MENU.has(label) && !NOT_A_MENU.has(raw.trim());
}
