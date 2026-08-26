import type { NeuralMatch } from "@minui/core";

/**
 * 브라우저에서 `/api/match`를 부른다 — 원격 신경망 검색 (M11).
 *
 * <p><b>보내는 것은 질의 문자열과 사이트 id뿐이다.</b> 후보도 라벨도 안 보낸다 —
 * 서버가 벡터를 들고 있으므로 필요가 없다. `makeAssist`가 후보 20개를 함께 보내야 했던
 * 것과 대비된다. 그쪽은 "가진 것 중 고르게" 하는 일이고 이쪽은 "없던 것을 데려오게"
 * 하는 일이라, 애초에 보낼 후보가 없다.
 *
 * <p>돌아오는 것도 <b>메뉴 id와 점수뿐</b>이다. 라벨이나 뜻풀이를 함께 받으면 화면이
 * 그것을 쓰기 시작하고, 그 순간 서버가 카탈로그의 일부를 들고 있는 셈이 된다.
 *
 * <p>실패는 전부 빈 배열이다. 엔진이 그것을 로컬 결과로 받으므로 화면은 지금까지처럼
 * 되묻는다 (불변 규칙 9).
 */
export function makeRetrieve(catalogId: string) {
  return async (query: string): Promise<readonly NeuralMatch[]> => {
    const response = await fetch("/api/match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, catalogId }),
    });
    if (!response.ok) return [];

    const body = (await response.json()) as { matches?: NeuralMatch[] };
    return body.matches ?? [];
  };
}
