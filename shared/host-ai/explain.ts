import type { MenuCatalog, MenuId } from "@minui/core";
import { aiEndpoint, askRelay } from "./endpoints.js";
import { isSafeMenuLabel } from "./privacy.js";
import cache from "./explain-cache.json";
import sources from "./explain-sources.json";

/**
 * "이게 무슨 뜻이에요?" — **미리 구워 둔 답을 먼저 보고, 없으면 서버에 묻는다.**
 *
 * <p>배포는 GitHub Pages다. 정적 호스팅이라 `/api/explain` 중계가 없다. 그래서 답을
 * 빌드 타임에 받아 두고(`tools/src/build-explain-cache.ts`) 여기서 조회만 한다.
 * 결과적으로 <b>배포된 번들에도 서버에도 API 키가 존재하지 않는다</b> (절대 보호선 규칙 7).
 *
 * <p>런타임 호출을 지우지 않은 이유: 로컬 `pnpm --filter demos dev`에는 `/api/explain`이
 * 살아 있고, 캐시에 없는 메뉴(Studio로 방금 얹은 사이트가 그렇다)는 그쪽이 답한다.
 * <b>한 번도 안 도는 예비 경로는 예비가 아니다</b>(`stt.ts`의 원칙)를 지키려면 개발 중에
 * 계속 도는 편이 낫다.
 *
 * <p>키를 `menuId`가 아니라 `label|path`로 잡은 것은 의도다. 사이트가 개편돼 id가 바뀌어도
 * 이름이 같으면 뜻풀이는 그대로 맞고, 서버로 보내던 것과도 같은 값이라 두 경로가 어긋나지
 * 않는다.
 *
 * <p>돌려주는 값의 뜻은 화면 계약을 그대로 따른다 — `null`은 "물어봤는데 모른다"이고
 * `AllMenuSheet`가 그때 버튼을 되돌리지 않는다. 빈 문자열로 구워진 것(모델이 모른다고
 * 한 것)도 `null`로 접는다.
 */

const CACHE = cache as Record<string, string>;

/** 캐시 키. `tools/src/build-explain-cache.ts`의 `key()`와 **같은 규칙이어야 한다.** */
export function explainKey(label: string, path?: readonly string[]): string {
  return path && path.length > 0 ? `${label}|${path.join(">")}` : label;
}

/** 뜻풀이 하나와 그것이 어디서 왔는지 (AI-8). 화면이 출처 배지를 그린다. */
export interface ExplainAnswer {
  hint: string | null;
  provenance: "cache" | "ai";
  model?: string | undefined;
}

/**
 * <p><b>중계기가 있으면 캐시 밖도 답한다</b> (AI-2). 전에는 `/api/explain` 상대 경로만
 * 불렀고, 정적 배포에는 그 주소가 없어 캐시에 없는 메뉴는 늘 "뜻을 알 수 없었어요"였다.
 * 이제 중계기 주소가 설정돼 있으면 그쪽에 묻는다 — <b>배포된 공개 데모에서도</b> 캐시
 * 밖의 말이 풀린다.
 *
 * <p>중계기가 없으면 지금까지와 <b>바이트 단위로 같게</b> 돈다. 주소가 없으면 호출
 * 자체를 안 만들고, 프로덕션 번들에서 그 가지가 사라진다.
 */
export function makeExplain(catalog: MenuCatalog) {
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));
  const endpoint = aiEndpoint("explain");

  return async (menuId: MenuId): Promise<ExplainAnswer | null> => {
    const menu = byId.get(menuId);
    if (!menu) return null;

    const cached = CACHE[explainKey(menu.label, menu.path)];
    /*
     * **구워 둔 답이 먼저다.** 결정론이라 같은 메뉴에서 늘 같은 것이 나오고, 한도를
     * 안 쓰고, 즉시 뜬다. 모델은 캐시가 모르는 것만 맡는다 — 검색이 로컬 먼저인 것과
     * 같은 순서다.
     */
    if (cached !== undefined) {
      return cached.length > 0
        ? { hint: cached, provenance: "cache" }
        : { hint: null, provenance: "cache" };
    }

    // 주소가 없으면 여기서 끝. "못 물었다"와 "물었는데 모른다"를 화면에서 가르지 않는다.
    if (!endpoint) return { hint: null, provenance: "cache" };

    // 카탈로그는 남의 사이트에서 긁어온 것이다. 사람 이름이 든 라벨을 내보내지 않는다.
    if (!isSafeMenuLabel(menu.label)) return { hint: null, provenance: "cache" };

    const answer = await askRelay(
      endpoint,
      { label: menu.label, ...(menu.path ? { path: menu.path } : {}) },
      (payload) => {
        const hint = payload["hint"];
        if (typeof hint !== "string" || hint.length === 0) return null;
        const model = payload["model"];
        return {
          hint,
          provenance: "ai" as const,
          ...(typeof model === "string" ? { model } : {}),
        };
      },
    );

    return answer ?? { hint: null, provenance: "cache" };
  };
}

/**
 * **근거가 있는 뜻풀이.** 설명과 그 설명이 나온 문장이 한 덩어리다.
 *
 * <p>둘을 따로 두지 않은 것이 요점이다. 이름만 보고 쓴 설명에 문서 인용을 나중에 붙이면
 * <b>그 인용이 그 설명을 뒷받침하지 않는다</b> — 같이 나온 것이 아니기 때문이다.
 * 출처가 붙은 문장은 더 믿기게 되므로, 그 믿음이 정당하려면 둘이 함께 만들어져야 한다.
 */
export interface GroundedHint {
  /** 안내문을 읽고 쓴 한 줄 설명. */
  hint: string;
  /** 그 설명의 근거로 안내문에 <b>그대로</b> 있는 문장. 모델이 다시 쓴 것이 아니다. */
  quote: string;
  /** 사람이 눌러 확인할 수 있는 원문 주소. */
  url: string;
  /** 어느 문서인지. "출처: …"에 그대로 들어간다. */
  title: string;
}

const GROUNDED = sources as Record<string, GroundedHint>;

/**
 * 그 메뉴에 **근거 있는 뜻풀이**가 있으면 준다. 없으면 `null`.
 *
 * <p>동기 조회다 — 근거 있는 답은 뜻풀이와 함께 빌드 타임에 구워지고
 * (`tools/src/build-explain-cache.ts`), 지어낸 인용은 굽는 자리에서 이미 걸러졌다
 * (`services/enricher/src/cite.ts`). 런타임에 물을 것이 없다.
 *
 * <p><b>없는 것이 정상이다.</b> 공개 안내문이 붙은 메뉴에만 있고, 나머지는 지금까지처럼
 * 이름만 보고 푼 답이다. 그 둘을 화면에서 같아 보이게 하면 안 된다.
 */
export function makeGroundedHint(catalog: MenuCatalog) {
  const byId = new Map(catalog.map((menu) => [menu.id, menu]));

  return (menuId: MenuId): GroundedHint | null => {
    const menu = byId.get(menuId);
    if (!menu) return null;
    return GROUNDED[explainKey(menu.label, menu.path)] ?? null;
  };
}
