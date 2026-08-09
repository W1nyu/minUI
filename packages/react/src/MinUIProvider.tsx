import { MinUIEngine, type MinUIEngineOptions } from "@minui/core";
import type { ColdStartProfile, MenuId, RankedCard, TextScale } from "@minui/core";
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface MinUIContextValue {
  engine: MinUIEngine;
  /** 홈에 그릴 카드. 세션 도중에는 핀 조작으로만 바뀐다. */
  cards: RankedCard[];
  profile: ColdStartProfile;
  setTextScale: (scale: TextScale) => void;
  setProfile: (profile: ColdStartProfile) => void;
  open: (menuId: MenuId, params?: Record<string, unknown>) => void;
  complete: (menuId: MenuId) => void;
  togglePin: (menuId: MenuId) => void;
  isPinned: (menuId: MenuId) => boolean;
}

export const MinUIContext = createContext<MinUIContextValue | null>(null);

export interface MinUIProviderProps extends MinUIEngineOptions {
  children: ReactNode;
  /** 엔진이 준비될 때까지 보여줄 것. 기본은 아무것도 그리지 않음 */
  fallback?: ReactNode;
}

/**
 * 엔진 인스턴스를 만들고 세션 수명을 React에 붙인다.
 *
 * 카드 상태를 React state로 들고 있는 이유는 렌더링 때문이지, 재계산 때문이 아니다.
 * 재배치 결정은 엔진이 세션 시작 때 한 번만 내린다 — 여기서 useMemo나 의존성 배열로
 * 다시 계산하기 시작하면 "세션 도중 화면이 바뀌지 않는다"는 규칙이 조용히 깨진다.
 */
export function MinUIProvider({
  children,
  fallback = null,
  ...options
}: MinUIProviderProps) {
  const [engine, setEngine] = useState<MinUIEngine | null>(null);
  const [cards, setCards] = useState<RankedCard[]>([]);
  const [profile, setProfileState] = useState<ColdStartProfile>({
    intent: "inquiry",
    textScale: "normal",
  });

  // 옵션 객체가 매 렌더 새로 만들어지더라도 엔진을 다시 만들면 안 된다.
  // 엔진 재생성은 곧 새 세션이고, 새 세션은 카드가 바뀔 수 있는 시점이다.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;

    void MinUIEngine.create(optionsRef.current).then((created) => {
      if (cancelled) {
        void created.close();
        return;
      }
      setEngine(created);
      setCards(created.getCards());
      setProfileState(created.getProfile());
    });

    return () => {
      cancelled = true;
    };
    // 의도적으로 빈 배열: 한 마운트 = 한 세션.
  }, []);

  const refresh = useCallback((instance: MinUIEngine) => {
    setCards(instance.getCards());
    setProfileState(instance.getProfile());
  }, []);

  const value = useMemo<MinUIContextValue | null>(() => {
    if (!engine) return null;

    return {
      engine,
      cards,
      profile,
      open: (menuId, params) => {
        engine.open(menuId, params);
      },
      complete: (menuId) => {
        engine.complete(menuId);
      },
      togglePin: (menuId) => {
        const action = engine.isPinned(menuId)
          ? engine.unpin(menuId)
          : engine.pin(menuId);
        void action.then(() => refresh(engine));
      },
      isPinned: (menuId) => engine.isPinned(menuId),
      setTextScale: (textScale) => {
        void engine
          .setProfile({ ...engine.getProfile(), textScale })
          .then(() => refresh(engine));
      },
      setProfile: (next) => {
        void engine.setProfile(next).then(() => refresh(engine));
      },
    };
  }, [engine, cards, profile, refresh]);

  // 글씨 크기는 문서 루트에 얹는다. 시트·모달처럼 포털로 나가는 요소까지
  // 같은 배율을 받아야 하기 때문이다.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const previous = root.getAttribute("data-minui-scale");
    root.setAttribute("data-minui-scale", profile.textScale);
    return () => {
      if (previous === null) root.removeAttribute("data-minui-scale");
      else root.setAttribute("data-minui-scale", previous);
    };
  }, [profile.textScale]);

  if (!value) return <>{fallback}</>;
  return <MinUIContext.Provider value={value}>{children}</MinUIContext.Provider>;
}
