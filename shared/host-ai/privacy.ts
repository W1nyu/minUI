/**
 * 원격 모델 경계를 넘어도 되는 말인가. **한 곳에만 있는 규칙이다** (AI-2).
 *
 * <p>이 판정은 원래 `assist.ts` 안에 있었고, 그래서 `/api/assist` 하나만 지켰다.
 * 중계기가 넷으로 늘면서(`/assist`·`/explain`·`/clarify`·`/confirm`) 그대로 두면
 * <b>새 경로 셋이 문 없이 열린다.</b> 그래서 따로 뺐다.
 *
 * <p>따로 뺀 두 번째 이유는 <b>서버도 이것을 봐야 하기 때문</b>이다. 브라우저에서만
 * 거르면 그 검사는 브라우저를 안 거치는 요청 앞에서 없는 것과 같다. `assist.ts`에는
 * `import.meta.env`가 있어 Worker에서 못 읽는데, 이 파일에는 그런 것이 없다 —
 * 브라우저·Node·Worker 어디서나 같은 코드가 돈다.
 *
 * <p><b>거르는 것보다 안 담는 것이 낫다.</b> 이 문은 마지막 방어선이고, 앞선 설계는
 * 애초에 값을 담지 않는 쪽이다 (`confirm.ts`는 위험도와 점검 이름만 보낸다).
 */

/**
 * 원격 도우미로 보내도 되는 발화인가.
 *
 * <p>로컬 검색에는 <b>모든</b> 질의가 그대로 간다. 이 문이 정하는 것은 선택적인 원격
 * 경계를 넘어도 되는가뿐이다 — 막힌 말도 기능을 잃지 않고 로컬 검색·되묻기로 끝난다.
 *
 * <p>넷을 막는다. 숫자(금액·계좌번호·날짜가 전부 숫자로 온다), 거래를 말하는 낱말,
 * 계좌를 말하는 낱말, 그리고 <b>사람을 부르는 한국어 어미</b>("김미영한테")다.
 * 마지막 것이 요점이다 — 이름은 목록에 없어도 발화에는 있다.
 */
export function isSafeAssistQuery(query: string): boolean {
  const normalized = query.normalize("NFC").trim();
  if (normalized.length === 0) return false;

  return !(
    /[0-9０-９]/.test(normalized) ||
    /송금|입금|출금|보내|받아|계좌|잔액|금액/.test(normalized) ||
    /(?<!자동)이체/.test(normalized) ||
    /[가-힣]{2,}(?:에게|한테|께|님)/.test(normalized)
  );
}

/**
 * 모델에게 보낼 <b>메뉴 이름</b>이 안전한가.
 *
 * <p>뜻풀이(`/explain`)는 사용자 발화가 아니라 카탈로그의 라벨을 보낸다. 라벨은 우리가
 * 만든 것이라 개인정보가 들어갈 일이 없어야 하지만, 카탈로그는 <b>남의 사이트에서 긁어온
 * 것</b>이다. 수집기가 로그인 뒤 화면을 잘못 읽어 "홍길동님의 계좌" 같은 문자열을
 * 라벨로 만들 수 있다. 그때 그것이 그대로 모델로 나가면 안 된다.
 */
export function isSafeMenuLabel(label: string): boolean {
  const normalized = label.normalize("NFC").trim();
  if (normalized.length === 0) return false;
  // 라벨에 숫자가 드는 것은 정상이다("1일 한도"). 사람을 가리키는 모양만 막는다.
  return !/[가-힣]{2,}(?:님|씨)\s*의?\s/.test(normalized) && !/\d{6,}/.test(normalized);
}
