/**
 * 중계기의 네 경로가 어디 있는가 (AI-2).
 *
 * <p>설정은 여전히 `VITE_ASSIST_URL` 하나다. 넷으로 늘렸다고 환경변수를 넷으로 늘리면
 * 배포할 때 셋을 빠뜨리는 날이 온다 — <b>중계기는 한 덩어리로 뜨고 한 덩어리로 진다.</b>
 * 그래서 주소 하나에서 형제 경로를 유도한다.
 *
 * <p><b>기존 배포와 호환된다.</b> 지금 `ASSIST_URL`은 Worker 루트를 가리키고, Worker는
 * 루트를 `/assist`로 읽는다. 그래서 `assist`는 설정값을 <b>그대로</b> 쓰고 나머지 다섯만
 * 형제 경로를 만든다 — 이미 넣어 둔 값을 고치지 않아도 켜진다.
 *
 * <p>비어 있으면 전부 `undefined`다. 그러면 호출자가 capability 자체를 안 넘기고,
 * <b>호출이 한 번도 일어나지 않는다.</b> 이 성질을 깨지 않는 것이 이 파일의 유일한
 * 규칙이다.
 *
 * <p><b>처음에 "번들에서 호출 경로가 통째로 사라진다"고 적었다가 재 보고 고쳤다.</b>
 * 사라지는 것은 <b>주소</b>지 경로 이름이 아니다 — 주소를 안 준 빌드에서 그 호스트
 * 문자열은 0건이지만, `aiEndpoint("clarify")`의 `"clarify"`는 인자라서 그대로 남는다.
 * M11의 `/api/match`가 통째로 사라진 것은 플래그가 <b>import를 감싸는</b> 빌드 타임
 * 상수여서였고, 여기는 그 모양이 아니다.
 *
 * <p>남아도 새는 것은 없다 — 경로 이름은 주소가 아니고 키는 애초에 여기 없다.
 * 그래도 근거 없이 더 세게 말하지 않는다. 이 저장소가 뜻풀이에 원문 인용을 붙인
 * 이유와 같다.
 */

export type AiRoute =
  | "assist"
  | "explain"
  | "clarify"
  | "confirm"
  | "safety"
  | "correct";

/** 설정된 중계기 주소. 없으면 `undefined`. */
function configured(): string | undefined {
  const value = import.meta.env.VITE_ASSIST_URL;
  return value && value.length > 0 ? value : undefined;
}

/**
 * 경로 하나의 주소.
 *
 * <p>로컬 dev에는 vite 플러그인이 `/api/*`를 열어 두므로 상대 경로가 기본값이다.
 * 배포(PROD)에 중계기 주소가 없으면 `undefined` — 있는 척하지 않는다.
 */
export function aiEndpoint(route: AiRoute): string | undefined {
  const base = configured();

  if (!base) return import.meta.env.PROD ? undefined : `/api/${route}`;
  if (route === "assist") return base;

  // 끝의 `/`와 `/assist`를 떼고 형제를 붙인다. 둘 중 어느 모양으로 넣었어도 같게 만든다.
  const root = base.replace(/\/+$/, "").replace(/\/assist$/, "");
  return `${root}/${route}`;
}

/**
 * 중계기에 JSON 하나를 묻는다. **실패는 전부 `null`이다.**
 *
 * <p>못 닿았는지, 거절당했는지, 모른다고 답했는지를 화면에서 가르지 않는다. 셋 다
 * 사용자에게는 같은 뜻이고 — 다음 선택지가 이미 화면에 있다 — 상태를 늘리면 그것을
 * 다루는 코드가 화면마다 늘어난다.
 */
export async function askRelay<T>(
  endpoint: string,
  body: unknown,
  read: (payload: Record<string, unknown>) => T | null,
): Promise<T | null> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return read((await response.json()) as Record<string, unknown>);
  } catch {
    return null;
  }
}
