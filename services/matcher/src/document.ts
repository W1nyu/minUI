/**
 * 메뉴 하나를 벡터로 굽기 전에, **무슨 글로 구울 것인가.**
 *
 * <h3>규칙 10과 스치는 자리</h3>
 * 불변 규칙 10은 "동의어를 미리 붙이지 않는다"이고, 근거는 실측이다 — 사람 것만 썼을 때
 * 85%가 전 메뉴에 LLM 동의어를 얹으니 <b>67%로 떨어졌다.</b> 빗나간 표현들이 서로를
 * 방해했기 때문이다.
 *
 * <p>여기서 하는 일은 그것과 다르다. 색인의 term을 늘리는 것이 아니라 <b>한 메뉴를 한
 * 벡터로 만드는 데 쓸 글</b>을 고른다. 벡터는 메뉴당 하나뿐이라 표현들이 서로를 밀어낼
 * 자리가 구조적으로 없다 — 2,800개의 빗나간 동의어가 정답을 밀어낸 그 경로가 여기엔 없다.
 *
 * <p><b>`hint`는 기본으로 뺀다 — 재 보고 뺐다</b> (2026-08-24).
 * <pre>
 *                       뜻풀이 뺌   뜻풀이 넣음
 *   blind-paraphrase      12.4%  →    44.1%    (+31.7%p)
 *   legacy-regression     62.7%  →    56.0%    (−6.7%p)   ← 사람이 쓴 질의
 * </pre>
 *
 * <p><b>순환이다.</b> blind 질의는 그 뜻풀이를 보고 쓴 것이라 크게 오르는 것이 당연하고,
 * 정작 사람이 쓴 질의에서는 <b>떨어진다.</b> §16의 85%→67%와 같은 모양이다 — 모델이 쓴
 * 글을 색인에 넣으면 그것에서 파생된 지표만 오르고 실제 사용자는 손해를 본다.
 *
 * <p>그러므로 <b>이 플래그를 켜려면 새 근거가 있어야 한다.</b> 사람이 쓴 질의에서
 * 오르는 것을 보이거나, 뜻풀이가 아닌 <b>공식 문서</b>처럼 모델이 안 쓴 글을 넣는 경우다.
 */

export interface DocumentInput {
  label: string;
  synonyms?: readonly string[] | undefined;
  path?: readonly string[] | undefined;
  hint?: string | undefined;
}

export interface DocumentOptions {
  /** 뜻풀이를 넣을 것인가. **기본은 안 넣는다** — 위 doc 참고. */
  includeHint?: boolean;
}

export function menuDocument(menu: DocumentInput, options: DocumentOptions = {}): string {
  const parts = [
    menu.label,
    ...(menu.synonyms ?? []),
    /*
     * 갈래를 넣는다. 신한은행에만 `조회`라는 이름이 여러 갈래 아래 있는데, 갈래가 없으면
     * 그 벡터들이 서로 구분되지 않고 원격이 엉뚱한 `조회`를 데려온다.
     */
    ...(menu.path ?? []),
    ...(options.includeHint && menu.hint ? [menu.hint] : []),
  ];

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const text = part?.trim();
    if (!text) continue;
    // 라벨과 동의어가 겹치는 메뉴가 실재한다. 두 번 넣으면 그 말의 무게만 커진다.
    if (seen.has(text)) continue;
    seen.add(text);
    kept.push(text);
  }

  return kept.join(" ");
}
