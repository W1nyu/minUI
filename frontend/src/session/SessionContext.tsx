import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEMO_USERS, canSignIn, userById, type DemoUser } from "./personas.js";

/**
 * 지금 누구로 보고 있는가.
 *
 * <p><b>인증이 아니다. 비밀번호도 없다.</b> 로그인 화면의 키패드는 은행 앱의 모양을
 * 보여 주려고 둔 시늉이고, 무엇을 누르든 들어간다. 토큰도 만료도 잠금도 없다.
 *
 * <p>그렇게 둔 것이 의도다. 비교할 번호를 어딘가에 적어 두면 그것만으로 화면이
 * "지켜지고 있다"고 말하게 되는데, 이 데모가 지키는 것은 아무것도 없다.
 * `demo-session-token`을 다룬 방식 그대로다.
 *
 * <p>남기는 것은 <b>사용자 id 하나</b>다. 누른 숫자는 어디에도 가지 않는다.
 */

const STORAGE_KEY = "minui.demo.session.v1";

interface SessionValue {
  user: DemoUser | null;
  /**
   * 그 사람으로 들어간다. 표에 있는 사람이면 늘 참이다.
   *
   * <p>누른 숫자를 받지 않는다 — 받아 두면 언젠가 그것으로 무엇을 하게 되고,
   * 그 순간 이 화면이 지키는 것이 있는 척하게 된다.
   */
  signIn: (userId: string) => boolean;
  signOut: () => void;
  /** 진행자용 빠른 전환 — 키패드를 거치지 않는다. 시연 중 왕복이 잦아서 둔다. */
  viewAs: (userId: string) => void;
  users: readonly DemoUser[];
}

const SessionContext = createContext<SessionValue | null>(null);

function readStoredUser(): DemoUser | null {
  try {
    const userId = sessionStorage.getItem(STORAGE_KEY);
    return userId ? (userById(userId) ?? null) : null;
  } catch {
    // 사생활 보호 모드처럼 저장소가 막혀 있어도 로그인 자체는 된다 — 새로고침하면 풀릴 뿐이다.
    return null;
  }
}

function rememberUser(userId: string | null): void {
  try {
    if (userId === null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, userId);
  } catch {
    // 저장에 실패해도 이 탭 안에서는 그대로 진행한다.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(() => readStoredUser());

  const signIn = useCallback((userId: string) => {
    if (!canSignIn(userId)) return false;
    const next = userById(userId) ?? null;
    setUser(next);
    rememberUser(next?.id ?? null);
    return true;
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    rememberUser(null);
  }, []);

  const viewAs = useCallback((userId: string) => {
    const next = userById(userId) ?? null;
    setUser(next);
    rememberUser(next?.id ?? null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, signIn, signOut, viewAs, users: DEMO_USERS }),
    [user, signIn, signOut, viewAs],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession은 <SessionProvider> 안에서만 쓸 수 있습니다.");
  return value;
}

/**
 * 로그인하지 않은 화면에서도 부를 수 있는 인사말용 조회.
 *
 * <p>Provider 밖에서 부르면 `null`이다 — 이름을 못 찾았다고 화면이 터지는 것보다
 * 이름 없이 도는 편이 낫다. 테스트가 `App`을 단독으로 그리는 길이 그대로 남는다.
 */
export function useSessionUser(): DemoUser | null {
  return useOptionalSession()?.user ?? null;
}

/**
 * Provider가 있으면 세션, 없으면 `null`.
 *
 * <p>`App`을 단독으로 그리는 기존 테스트와 계측 대본이 그대로 돌아야 해서 필요하다 —
 * 없다고 화면이 터지는 것보다 그 자리에 아무것도 안 그리는 편이 낫다.
 */
export function useOptionalSession(): SessionValue | null {
  return useContext(SessionContext);
}
