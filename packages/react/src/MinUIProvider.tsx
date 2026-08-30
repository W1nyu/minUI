import { DEFAULT_CONFIG, MinUIEngine, type MinUIEngineOptions } from "@minui/core";
import type {
  CardExplanation,
  ColdStartProfile,
  Contrast,
  LearnedTerm,
  MenuId,
  NeuralRetriever,
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
import type { HintProvenance } from "./ProvenanceBadge.js";

/**
 * 근거가 있는 뜻풀이. 설명과 그 설명이 나온 문장이 한 덩어리다.
 *
 * <p>`shared/host-ai`의 것과 같은 모양이되 여기서 다시 선언한다 — `packages/react`는
 * 이식형 패키지라 호스트 쪽 파일을 참조하지 않는다. 호스트가 무엇으로 근거를 만들든
 * 화면이 요구하는 것은 이 넷뿐이다.
 */
/**
 * 뜻풀이 하나와 **그것이 어디서 왔는지** (AI-8).
 *
 * <p>호스트는 지금까지처럼 문자열만 돌려줘도 된다. 이 모양으로 돌려주면 화면이 출처
 * 배지를 함께 그린다 — 계약을 넓히되 <b>기존 호스트를 깨지 않는다.</b>
 */
export interface MenuExplanation {
  hint: string | null;
  provenance: HintProvenance;
  /** `ai`일 때 어느 모델이 답했는지. 배지에 그대로 실린다. */
  model?: string | undefined;
}

/**
 * 못 알아들었을 때 한 문장으로 되묻기 (AI-3).
 *
 * <p>모델은 <b>질문을 쓰고 이미 있는 갈래 중 둘을 고를</b> 뿐이다. 갈래를 만들지 못한다 —
 * 화면이 자기 갈래 목록을 넘기고, 돌아온 이름을 그 목록에서 다시 찾는다.
 */
/**
 * 도우미가 낸 것 하나 (AI-9).
 *
 * <p>호스트는 지금까지처럼 `MenuId`만 돌려줘도 된다. 이 모양으로 돌려주면 화면이
 * <b>AI가 낸 것임을</b> 밝히고, 모델이 쓴 한 줄과 <b>버린 것</b>까지 함께 그린다.
 */
export interface MenuAssistAnswer {
  menuId: MenuId;
  why?: string | undefined;
  model?: string | undefined;
  /** 검증에서 버린 것이 있으면 그 이유. */
  dropped?: string | undefined;
}

export interface MenuClarification {
  question: string;
  branches: { label: string }[];
  model?: string | undefined;
}

export interface MenuGroundedHint {
  /** 안내문을 읽고 쓴 한 줄 설명. */
  hint: string;
  /** 안내문에 그대로 있는 문장. */
  quote: string;
  url: string;
  /** 어느 문서인지. "출처: …"에 들어간다. */
  title: string;
}

/**
 * 읽어 주기 (F16). **`SttLike`와 같은 모양의 구조적 계약이다.**
 *
 * <p>`@minui/voice`를 참조하지 않고 여기서 다시 선언한다 — `packages/react`는 이식형
 * 패키지라 다른 패키지에 의존하지 않고, 화면이 요구하는 것은 이 셋뿐이다. 호스트가
 * 브라우저 `speechSynthesis`를 쓰든 상용 TTS를 쓰든 이 모양이면 된다.
 */
export interface TtsLike {
  /** 이 환경에서 쓸 수 있는가. false면 읽기 버튼을 **아예 그리지 않는다.** */
  readonly isSupported: boolean;
  speak(text: string): void;
  cancel(): void;
}

export interface MinUIContextValue {
  engine: MinUIEngine;
  /** 호스트가 넘긴 읽어 주기. 없으면 undefined이고 읽기 버튼이 생기지 않는다. */
  tts?: TtsLike | undefined;
  /** 호스트가 넘긴 도우미. 없으면 undefined. */
  assist?:
    | ((
        query: string,
        candidates: MenuId[],
      ) => Promise<MenuId | MenuAssistAnswer | null>)
    | undefined;
  /** 호스트가 넘긴 뜻풀이 도우미. 없으면 undefined. */
  explain?:
    | ((menuId: MenuId) => Promise<string | MenuExplanation | null>)
    | undefined;
  /** 근거 있는 뜻풀이. 호스트가 안 넘기면 화면은 지금까지처럼 답만 보여 준다. */
  groundedHint?: ((menuId: MenuId) => MenuGroundedHint | null) | undefined;
  /** 한 문장 되묻기 (AI-3). 없으면 지금까지의 갈래 되묻기가 그대로 답이다. */
  clarify?:
    | ((
        query: string,
        branches: readonly { label: string }[],
      ) => Promise<MenuClarification | null>)
    | undefined;
  /** 잘못 들린 말 고쳐 쓰기 (AI-6). 없으면 들린 그대로 찾는다. */
  correct?:
    | ((
        heard: string,
        pool: readonly MenuId[],
      ) => Promise<{ query: string; model?: string | undefined } | null>)
    | undefined;
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
  /** 화면 대비 (F17). 색만 바뀌고 배치는 그대로다. */
  setContrast: (contrast: Contrast) => void;
  setProfile: (profile: ColdStartProfile) => void;
  open: (menuId: MenuId, params?: Record<string, unknown>) => void;
  complete: (menuId: MenuId) => void;
  togglePin: (menuId: MenuId) => void;
  isPinned: (menuId: MenuId) => boolean;
  /** 사용자가 직접 고른 홈 카드 순서. 카드 수만큼만 유지된다. */
  pinnedMenuIds: readonly MenuId[];
  setPinnedMenuIds: (menuIds: readonly MenuId[]) => Promise<void>;
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
  assist?: (
    query: string,
    candidates: MenuId[],
  ) => Promise<MenuId | MenuAssistAnswer | null>;
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
  explain?: (menuId: MenuId) => Promise<string | MenuExplanation | null>;
  /**
   * 그 뜻풀이가 **어디서 왔는지** (Task 4). 선택이다.
   *
   * <p>`explain`과 나뉜 이유는 근거가 <b>있는 답이 예외</b>이기 때문이다 — 공개 안내문이
   * 붙은 메뉴에만 있고, 나머지는 지금처럼 이름만 보고 푼 답이다. 그리고 이쪽은 설명과
   * 인용이 <b>함께</b> 만들어진 한 덩어리라, 뒤늦게 합칠 수 있는 것이 아니다.
   *
   * <p>동기 함수인 것도 의도다. 근거는 빌드 타임에 구워져 있고, 지어낸 인용은 굽는
   * 자리에서 이미 걸러졌다. 런타임에 물을 것이 없다.
   */
  groundedHint?: (menuId: MenuId) => MenuGroundedHint | null;
  /**
   * 못 알아들었을 때 **한 문장으로 되묻는** 도우미 (AI-3). **선택이다.**
   *
   * <p>`assist`가 후보 중 하나를 고르는 것이라면 이것은 <b>고르기 전 단계</b>다.
   * 없으면 지금까지처럼 갈래 이름만 나열한 되묻기가 뜬다 — 기능이 사라지는 것이 아니라
   * 문장 한 줄이 없을 뿐이다.
   */
  clarify?: (
    query: string,
    branches: readonly { label: string }[],
  ) => Promise<MenuClarification | null>;
  /**
   * 음성 인식이 잘못 들었을 때 **말을 고쳐 쓰는** 도우미 (AI-6). **선택이다.**
   *
   * <p>`assist`와 결정적으로 다르다 — 이것은 <b>목적지를 고르지 않는다.</b> 고쳐진 말은
   * 평소의 검색을 그대로 지나므로 배운 말·자모 보정·위험도 경계가 전부 살아 있다.
   * 없으면 들린 그대로 찾고, 그것이 지금까지의 동작이다.
   */
  correct?: (
    heard: string,
    pool: readonly MenuId[],
  ) => Promise<{ query: string; model?: string | undefined } | null>;
  /**
   * 원격 신경망 검색 (M11). **선택이다.**
   *
   * <p>`assist`와 같은 모양의 계약이다 — 엔진은 이것이 신경망인지 사전인지 사람인지
   * 모른다. 없으면 검색이 지금까지와 <b>바이트 단위로 같게</b> 돈다.
   *
   * <p>`assist`와 겹치지 않는다. `assist`는 이미 가진 후보 중 하나를 고르고, 이것은
   * <b>로컬이 0점을 준 메뉴를 데려온다.</b> 둘 다 있으면 원격 → 도우미 순으로 쌓인다.
   *
   * <p>기다림의 상한은 <b>여기서 씌운다</b>(`neural.timeoutMs`). core는 시간을 재지
   * 못하기 때문이다 — 불변 규칙 1.
   */
  retrieve?: NeuralRetriever;
  /**
   * 화면을 읽어 주는 도우미 (F16). **선택이다.**
   *
   * <p>`assist`·`explain`과 같은 모양이다 — 없으면 읽기 버튼이 생기지 않고, 화면은
   * 지금까지와 똑같이 돈다. 버튼을 그려 놓고 눌러도 아무 일이 없게 두는 것보다
   * 아예 없는 편이 낫다. 고령 사용자에게 <b>반응 없는 버튼은 고장</b>이다.
   */
  tts?: TtsLike;
}

/**
 * 문서 루트에 속성 하나를 얹고, 떠날 때 원래대로 돌려놓는다.
 *
 * <p>루트에 얹는 이유는 시트·모달이 포털로 나가기 때문이다 — 앱 컨테이너에 걸면 그것들이
 * 배율과 대비를 못 받는다. 원래 값을 기억했다가 되돌리는 것은 한 페이지에 여러 Provider가
 * 있을 수 있어서다(테스트가 실제로 그렇게 한다).
 */
function useRootAttribute(name: string, value: string | null): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const previous = root.getAttribute(name);
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
    return () => {
      if (previous === null) root.removeAttribute(name);
      else root.setAttribute(name, previous);
    };
  }, [name, value]);
}

/**
 * 원격 검색에 기다림의 상한을 씌운다 (M11).
 *
 * <p><b>이 일이 왜 여기 있는가.</b> core는 Node·브라우저 전역에 손대지 않으므로
 * (불변 규칙 1, `portability.test.ts`가 강제한다) 시간을 잴 수 없다 — 엔진이
 * `Date.now()` 대신 주입된 `now`를 쓰는 것과 같은 이유다. <b>시계를 가진 층이 시간을
 * 재야 하고, 그 층이 여기다.</b>
 *
 * <p>상한을 넘으면 거부한다. 엔진은 거부를 로컬 결과로 받으므로 화면은 되묻기로
 * 돌아간다 — 고령 사용자에게 <b>침묵은 고장으로 읽힌다.</b> 멈춘 화면은 막다른 길이지만
 * 되묻기는 아니다.
 *
 * <p>값은 `MinUIConfig`에 남는다(규칙 3). 여기 상수로 박으면 다른 언어로 포팅할 때
 * 그 층이 같은 값을 찾을 곳이 없어진다.
 */
function withTimeout(retrieve: NeuralRetriever, timeoutMs: number): NeuralRetriever {
  return (query) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("원격 검색 시간 초과")), timeoutMs);
      retrieve(query).then(
        (matches) => {
          clearTimeout(timer);
          resolve(matches);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
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
  groundedHint,
  clarify,
  correct,
  retrieve,
  tts,
  ...options
}: MinUIProviderProps) {
  const [engine, setEngine] = useState<MinUIEngine | null>(null);
  const [cards, setCards] = useState<RankedCard[]>([]);
  const [profile, setProfileState] = useState<ColdStartProfile>({
    intent: "inquiry",
    textScale: "normal",
  });
  const [learnedTerms, setLearnedTerms] = useState<readonly LearnedTerm[]>([]);

  /*
   * 원격 검색은 상한을 씌워 넘긴다 (M11). 상한 값은 호스트 설정 → 기본값 순으로 읽는다 —
   * 엔진이 `resolveConfig`로 병합하기 전이라 여기서 한 번 더 본다.
   */
  const wrappedRetrieve = useMemo(
    () =>
      retrieve
        ? withTimeout(
            retrieve,
            options.config?.search?.neural?.timeoutMs ??
              DEFAULT_CONFIG.search.neural.timeoutMs,
          )
        : undefined,
    [retrieve, options.config?.search?.neural?.timeoutMs],
  );

  // 옵션 객체가 매 렌더 새로 만들어지더라도 엔진을 다시 만들면 안 된다.
  // 엔진 재생성은 곧 새 세션이고, 새 세션은 카드가 바뀔 수 있는 시점이다.
  const optionsRef = useRef({
    ...options,
    ...(wrappedRetrieve ? { retrieve: wrappedRetrieve } : {}),
  });
  optionsRef.current = {
    ...options,
    ...(wrappedRetrieve ? { retrieve: wrappedRetrieve } : {}),
  };

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
      groundedHint,
      clarify,
      correct,
      /*
       * **지원하지 않는 환경에서는 없는 것으로 친다.** 호스트가 넘겼더라도 그 브라우저에
       * `speechSynthesis`가 없으면 버튼이 있어도 소용없다. 판단을 여기서 한 번만 하면
       * 화면들이 각자 `isSupported`를 기억할 필요가 없다.
       */
      tts: tts?.isSupported ? tts : undefined,
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
      pinnedMenuIds: engine.getPinned(),
      setPinnedMenuIds: async (menuIds) => {
        await engine.setPinned(menuIds);
        refresh(engine);
      },
      setTextScale: (textScale) => {
        void engine
          .setProfile({ ...engine.getProfile(), textScale })
          .then(() => refresh(engine));
      },
      setContrast: (contrast) => {
        void engine
          .setProfile({ ...engine.getProfile(), contrast })
          .then(() => refresh(engine));
      },
      setProfile: (next) => {
        void engine.setProfile(next).then(() => refresh(engine));
      },
    };
  }, [
    engine,
    assist,
    explain,
    groundedHint,
    clarify,
    correct,
    tts,
    cards,
    profile,
    learnedTerms,
    refresh,
  ]);

  // 글씨 크기는 문서 루트에 얹는다. 시트·모달처럼 포털로 나가는 요소까지
  // 같은 배율을 받아야 하기 때문이다.
  useRootAttribute("data-minui-scale", profile.textScale);
  /*
   * 대비도 같은 자리에 같은 방식으로 (F17). 값이 `"normal"`이면 아예 안 붙인다 —
   * 붙여 두고 CSS에서 아무것도 안 하는 것보다, 없는 상태가 기본이라는 것이 DOM에
   * 그대로 보이는 편이 낫다.
   */
  useRootAttribute(
    "data-minui-contrast",
    profile.contrast === "high" ? "high" : null,
  );

  if (!value) return <>{fallback}</>;
  return <MinUIContext.Provider value={value}>{children}</MinUIContext.Provider>;
}
