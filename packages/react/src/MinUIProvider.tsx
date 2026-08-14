import { MinUIEngine, type MinUIEngineOptions } from "@minui/core";
import type {
  CardExplanation,
  ColdStartProfile,
  LearnedTerm,
  MenuId,
  RankedCard,
  TextScale,
} from "@minui/core";
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
  /** 호스트가 넘긴 도우미. 없으면 undefined. */
  assist?: ((query: string, candidates: MenuId[]) => Promise<MenuId | null>) | undefined;
  /** 호스트가 넘긴 뜻풀이 도우미. 없으면 undefined. */
  explain?: ((menuId: MenuId) => Promise<string | null>) | undefined;
  /**
   * 홈에 그릴 카드.
   *
   * <p>기본 설정에서는 세션 도중 핀 조작으로만 바뀐다.
   * `stability.liveReorder`를 켠 호스트에서는 메뉴를 열 때마다 바뀔 수 있다.
   */
  cards: RankedCard[];
  profile: ColdStartProfile;
  /**
   * 이 기기가 배운 말 (M7). 자주 쓴 것부터.
   *
   * <p>state로 들고 있는 이유는 지울 수 있기 때문이다 — 지운 것이 화면에서 바로
   * 사라지지 않으면 사용자는 지워졌는지 알 수 없다.
   */
  learnedTerms: readonly LearnedTerm[];
  /** 카드가 왜 그 자리에 있는가 (M8). 판단은 엔진이 하고 문구는 화면이 고른다. */
  explainCards: () => CardExplanation[];
  forgetTerm: (term: string, menuId: MenuId) => void;
  forgetAllTerms: () => void;
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
  /**
   * 온디바이스가 못 찾았을 때 부르는 도우미. **선택이다.**
   *
   * <p>없으면 지금까지와 똑같이 되묻는다. 있으면 사용자가 한 말과 후보 목록을 넘겨
   * 그중 하나를 고르게 한다 — 실측에서 정확 매칭이 85% → 95%가 됐다.
   *
   * <p>이 계약이 좁은 것이 중요하다. 엔진은 <b>이것이 LLM인지 무엇인지 모른다.</b>
   * 네트워크·API 키·모델 이름이 코어와 React 어디에도 들어오지 않는다.
   * `null`을 돌려주면 "맞는 것 없음"이고, 그때는 원래대로 되묻는다.
   */
  assist?: (query: string, candidates: MenuId[]) => Promise<MenuId | null>;
  /**
   * 카탈로그에 뜻풀이가 없는 메뉴를 그 자리에서 푸는 도우미. **선택이다.**
   *
   * <p>`assist`와 같은 모양의 계약이다 — 엔진은 이것이 LLM인지 사전인지 사람인지 모른다.
   * 없으면 묻는 버튼조차 뜨지 않고, `null`을 돌려주면 모른다고 말한다.
   * <b>틀린 뜻풀이는 없는 것보다 나쁘다.</b>
   *
   * <p>빌드 타임 보강이 대부분을 미리 채우므로 여기까지 오는 것은 나머지뿐이다
   * (신한 930개 중 185개). 검색 폴백과 같은 구조다.
   */
  explain?: (menuId: MenuId) => Promise<string | null>;
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
  assist,
  explain,
  ...options
}: MinUIProviderProps) {
  const [engine, setEngine] = useState<MinUIEngine | null>(null);
  const [cards, setCards] = useState<RankedCard[]>([]);
  const [profile, setProfileState] = useState<ColdStartProfile>({
    intent: "inquiry",
    textScale: "normal",
  });
  const [learnedTerms, setLearnedTerms] = useState<readonly LearnedTerm[]>([]);

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
      setLearnedTerms(created.getLearnedTerms());
    });

    return () => {
      cancelled = true;
    };
    // 의도적으로 빈 배열: 한 마운트 = 한 세션.
  }, []);

  const refresh = useCallback((instance: MinUIEngine) => {
    // 같은 구성이면 상태를 갈아 끼우지 않는다. 카드가 안 바뀐 것을 리렌더로 알리면
    // "세션 도중 화면이 그대로"라는 규칙이 코드에서는 지켜져도 화면에서는 깜빡인다.
    setCards((previous) => {
      const next = instance.getCards();
      const same =
        previous.length === next.length &&
        previous.every(
          (card, index) =>
            card.menuId === next[index]?.menuId &&
            card.pinned === next[index]?.pinned &&
            card.isNew === next[index]?.isNew,
        );
      return same ? previous : next;
    });
    setProfileState(instance.getProfile());
    // 카드와 같은 이유로 동일성을 검사한다. `getLearnedTerms()`는 매번 새 배열을 주므로
    // 그냥 넣으면 메뉴를 열 때마다 화면 전체가 리렌더된다.
    setLearnedTerms((previous) => {
      const next = instance.getLearnedTerms();
      const same =
        previous.length === next.length &&
        previous.every(
          (entry, index) =>
            entry.term === next[index]?.term &&
            entry.menuId === next[index]?.menuId &&
            entry.count === next[index]?.count,
        );
      return same ? previous : next;
    });
  }, []);

  const value = useMemo<MinUIContextValue | null>(() => {
    if (!engine) return null;

    return {
      engine,
      assist,
      explain,
      cards,
      profile,
      learnedTerms,
      explainCards: () => engine.explainCards(),
      forgetTerm: (term, menuId) => {
        void engine.forgetTerm(term, menuId).then(() => refresh(engine));
      },
      forgetAllTerms: () => {
        void engine.forgetAllTerms().then(() => refresh(engine));
      },
      // 여닫을 때마다 카드를 다시 읽는다. stability.liveReorder가 꺼져 있으면 엔진이
      // 배치를 바꾸지 않으므로 refresh는 아무것도 하지 않는다 — 위 동일성 검사 참고.
      open: (menuId, params) => {
        engine.open(menuId, params);
        refresh(engine);
      },
      complete: (menuId) => {
        engine.complete(menuId);
        refresh(engine);
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
  }, [engine, assist, explain, cards, profile, learnedTerms, refresh]);

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
