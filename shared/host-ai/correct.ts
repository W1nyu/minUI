import type { MenuCatalog, MenuId } from "@minui/core";
import { aiEndpoint, askRelay } from "./endpoints.js";
import { isSafeAssistQuery } from "./privacy.js";

/**
 * 잘못 들린 말을 **질의로** 고쳐 쓴다 (AI-6).
 *
 * <p><b>목적지를 고르지 않는다.</b> 고쳐진 말은 평소의 로컬 검색을 그대로 지나고, 무엇이
 * 열릴지는 여전히 엔진이 정한다 — `riskLevel: high`는 §9.3이 그대로 막는다. 모델이 메뉴를
 * 고르는 `assist`와 나란히 두되 다른 일을 한다.
 *
 * <p>고친 말을 화면에 보여 줄 수 있다는 것도 이 설계의 값이다. "이렇게 들으신 것
 * 같아요: 자동이체 안 나가게"는 사용자가 <b>맞는지 확인할 수 있는</b> 말이지만, 모델이
 * 고른 메뉴는 왜 그것인지 알 수 없다.
 *
 * <p>참고용 메뉴 이름을 함께 보낸다 — 이 앱에 무엇이 있는지 모르면 모델이 엉뚱한 말로
 * 고친다. 보내는 것은 <b>이름</b>이지 사용자에 대한 것이 아니다 (§11.1).
 */

/** 참고로 보여 줄 메뉴 수. `assist`의 `CANDIDATE_COUNT`와 같은 이유로 묶는다. */
const MENU_COUNT = 20;

export interface Corrected {
  /** 고쳐진 질의. 들린 것과 반드시 다르다. */
  query: string;
  model?: string | undefined;
}

export function makeCorrect(catalog: MenuCatalog) {
  const endpoint = aiEndpoint("correct");
  if (!endpoint) return undefined;

  const byId = new Map(catalog.map((menu) => [menu.id, menu]));

  return async (heard: string, pool: readonly MenuId[]): Promise<Corrected | null> => {
    // 금융 개인정보일 수 있는 발화는 원격 경계를 넘지 않는다. 들린 말도 발화다.
    if (!isSafeAssistQuery(heard)) return null;

    /*
     * **후보가 비어도 묻는다.** 잘못 들린 말은 애초에 아무 데도 안 걸리므로
     * `engine.candidates`가 빈 배열을 주는 일이 흔하다 — 실제로 첫 시도에서 그래서
     * 교정이 한 번도 안 불렸다. 모델에게 필요한 것은 <b>점수 순 후보</b>가 아니라
     * <b>이 앱에 무엇이 있는지</b>이므로, 모자라면 카탈로그 앞에서 채운다.
     */
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const menuId of pool) {
      const menu = byId.get(menuId);
      if (menu && !seen.has(menu.label)) {
        seen.add(menu.label);
        labels.push(menu.label);
      }
      if (labels.length >= MENU_COUNT) break;
    }
    for (const menu of catalog) {
      if (labels.length >= MENU_COUNT) break;
      if (seen.has(menu.label)) continue;
      seen.add(menu.label);
      labels.push(menu.label);
    }

    const candidates = labels.map((label) => ({ label }));
    if (candidates.length === 0) return null;

    return askRelay(endpoint, { heard, candidates }, (payload) => {
      const corrected = payload["corrected"];
      if (typeof corrected !== "string" || corrected.trim().length === 0) return null;

      /*
       * **같은 말이면 고친 것이 아니다.** 서버도 보지만 여기서 한 번 더 본다 —
       * 아무것도 안 바뀐 문장 옆에 "이렇게 들으신 것 같아요"가 뜨면 사용자는 화면이
       * 고장 났다고 읽는다.
       */
      const same = (value: string) => value.replace(/\s+/g, "");
      if (same(corrected) === same(heard)) return null;

      const model = payload["model"];
      return {
        query: corrected.trim(),
        ...(typeof model === "string" ? { model } : {}),
      };
    });
  };
}
