/**
 * 뜻풀이 한 줄의 검증 규칙. **빌드 타임과 런타임이 이것을 함께 쓴다.**
 *
 * <p>`prompt.ts`(빌드 타임 보강)와 `explain.ts`(런타임 "이게 무슨 뜻이에요?")가 서로 다른
 * 것을 통과시키면 사용자가 보는 뜻풀이의 품질이 <b>그것이 어디서 왔는가</b>에 따라
 * 달라진다. 카탈로그 조립에서 CLI와 Studio가 `buildMenus`를 함께 쓰는 것과 같은 이유다.
 *
 * <p><b>의존성이 없는 것이 의도다.</b> 이 파일이 `@minui/core`를 참조하면 데모 앱의
 * 개발 서버 미들웨어가 엔진 타입까지 끌고 들어온다 — 실제로 한 번 그렇게 됐다.
 */

/** 라벨에 들어오면 안 되는 것. `build-catalog.ts`와 같은 기준이다. */
export const PERSONAL_DATA = [
  /\d{2,6}-\d{2,6}-\d{4,}/,
  /\d{8,}/,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
];

/** 서술형 맺음말. 뜻풀이가 이름을 되풀이한 것인지 보려면 이걸 떼고 비교해야 한다. */
const PREDICATE_TAIL = /(입니다|합니다|이에요|예요|해요|하기|보기)$/;

const squash = (text: string) => text.replace(/[\s/·]+/g, "").toLowerCase();

/**
 * 묻지도 않았는데 붙는 뜻풀이의 상한.
 *
 * <p>빌드 타임 보강은 <b>모든 메뉴에</b> 설명을 깐다. 700줄짜리 목록에서 한 줄 설명이
 * 두 줄이 되면 메뉴 이름보다 설명이 눈에 띈다 — 목록이 다시 읽기 어려워진다.
 */
export const CATALOG_HINT_MAX = 30;

/**
 * 사용자가 <b>직접 물어서</b> 나오는 뜻풀이의 상한.
 *
 * <p>실측에서 30자로 잘랐더니 `반대매매`(34자)·`세금우대한도조회`(32자)·`랩잔고조회`(32자)가
 * 전부 버려지고 쉬운 `예수금`(26자)만 통과했다. 모델이 낸 풀이는 멀쩡했다 —
 * <b>어려운 말일수록 풀 말이 길어지는데 상한이 하필 그것들만 걸러 낸 것이다.</b>
 * 이 기능이 존재하는 이유가 바로 그 단어들이므로 규칙이 거꾸로 걸려 있었다.
 *
 * <p>물어본 답에는 여유를 준다. 묻지 않았는데 깔리는 것과 눌러서 받는 것은 다르다.
 */
export const ASKED_HINT_MAX = 45;

/**
 * 뜻풀이를 다듬고 검증한다.
 *
 * @param maxLength 길이 상한. 왜 두 값인지는 위 두 상수의 설명 참고.
 * @returns 쓸 만하면 다듬은 문자열, 아니면 빈 문자열.
 */
export function cleanHint(
  value: unknown,
  label: string,
  maxLength: number = CATALOG_HINT_MAX,
): string {
  if (typeof value !== "string") return "";
  const hint = value.replace(/\s+/g, " ").trim();

  if (hint.length < 4 || hint.length > maxLength) return "";
  if (PERSONAL_DATA.some((pattern) => pattern.test(hint))) return "";

  /*
   * 이름을 되풀이한 것은 아무것도 풀어 주지 않는다 — `계좌조회` → `"계좌 조회입니다"`는
   * 모르는 말을 같은 말로 되돌려 주는 셈이다. 동의어에는 이미 있던 규칙인데
   * 뜻풀이에는 없었다.
   *
   * **같은지만 본다. 포함은 보지 않는다.** `"계좌조회는 통장에 남은 돈을 보는 것"`처럼
   * 이름을 품고 설명을 더한 것이 오히려 좋은 뜻풀이라, 포함으로 막으면 고치려던 것보다
   * 나빠진다 — 브랜드 이름을 통째로 버렸다가 되돌린 것과 같은 실수다.
   */
  if (squash(hint).replace(PREDICATE_TAIL, "") === squash(label)) return "";

  return hint;
}
