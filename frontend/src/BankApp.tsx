import { useEffect, useMemo } from "react";
import { App, type AppProps } from "./App.js";
import { SessionOpenBankingMockApi } from "./api/openBankingMock.js";
import type { BankApi } from "./api/types.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { SessionProvider, useSession } from "./session/SessionContext.js";

/**
 * 로그인 문 뒤에 앱을 둔다.
 *
 * <p><b>`App`을 감싸되 고치지 않는다.</b> `App`은 지금까지처럼 `api`와 `storageKey`를
 * 받아 도는 물건이고, 여기서 하는 일은 <b>그 둘을 사람에 따라 만들어 넘기는 것</b>뿐이다.
 * 그래서 기존 테스트가 `App`을 단독으로 그리는 길이 그대로 남는다 — 사용자 개념이
 * 없던 때의 대본이 아직 유효하다.
 */

export interface BankAppProps extends Omit<AppProps, "api" | "storageKey"> {
  /** 사용자별 원장 만들기. 테스트가 메모리 원장을 끼우는 자리다. */
  apiFor?: (userId: string) => BankApi;
  /** 저장소 키 앞자리. 테스트끼리 IndexedDB가 안 섞이게 한다. */
  storageKeyPrefix?: string;
  /** 어떤 키가 쓰였는지 알려 준다. 사람마다 자리가 다른지 재는 데 쓴다. */
  onStorageKey?: (key: string) => void;
}

export function BankApp(props: BankAppProps) {
  return (
    <SessionProvider>
      <BankAppInner {...props} />
    </SessionProvider>
  );
}

function BankAppInner({
  apiFor,
  storageKeyPrefix = "demo",
  onStorageKey,
  ...appProps
}: BankAppProps) {
  const { user, signIn, signOut } = useSession();

  /*
   * 사람이 바뀌면 원장도 저장소 키도 함께 바뀐다.
   *
   * <p>원장은 **하나를 나눠 본다** — `SessionOpenBankingMockApi`가 같은 탭 저장소를
   * 쓰므로 김순자가 보낸 돈이 박정호의 화면에 도착해 있다. 반면 저장소 키는 **사람마다
   * 다르다** — 배운 말과 홈 카드 배치는 개인의 것이라, 한 기기를 나눠 쓸 때 남의
   * 개인화가 내 화면에 뜨면 그 자체가 노출이다 (§11.1).
   */
  const api = useMemo(
    () =>
      user === null
        ? null
        : (apiFor?.(user.id) ?? new SessionOpenBankingMockApi({ userId: user.id })),
    [user, apiFor],
  );
  const storageKey = user === null ? null : `${storageKeyPrefix}:${user.id}`;

  useEffect(() => {
    if (storageKey !== null) onStorageKey?.(storageKey);
  }, [storageKey, onStorageKey]);

  if (user === null || api === null || storageKey === null) {
    return <LoginScreen onSignIn={signIn} />;
  }

  return (
    <App
      {...appProps}
      api={api}
      storageKey={storageKey}
      onExit={signOut}
      {...(api instanceof SessionOpenBankingMockApi
        ? { resetDemoLedger: () => api.resetDemoLedger() }
        : {})}
    />
  );
}
