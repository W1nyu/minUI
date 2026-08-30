import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** 화면에 보이는 이름은 낙인 없는 "도움 정도"다. 심리·의학적 불안도 진단이 아니다. */
export type SupportLevel = "simple" | "guided" | "standard";

export interface AdaptiveSupportConfig {
  /** 긴 누름/결정 지연으로 보는 시간. */
  slowPressMs: number;
  /** 말하기 버튼을 누른 뒤 결과까지 이만큼 걸리면 망설임 신호 하나다. */
  voiceHesitationMs: number;
  /** 화면을 열자마자 돌아온 경우를 오클릭의 약한 대리 신호로 본다. */
  quickBacktrackMs: number;
  /** 이 수보다 적은 신호에는 화면을 바꾸지 않는다. */
  minSignalsBeforeChange: number;
  /** 이 점수 이상이면 완전 단순형으로 한 단계 올린다. */
  simpleAtOrAbove: number;
  /** 이 점수 이하이면 일반 단순형으로 한 단계 낮춘다. */
  standardAtOrBelow: number;
  slowPressWeight: number;
  backtrackWeight: number;
  voiceHesitationWeight: number;
}

/**
 * 호스트가 교체할 수 있는 JSON 직렬화 가능 설정이다.
 *
 * <p>이 값은 임상 판정 임계값이 아니다. 사용자 테스트에서 "도움이 됐는지"를 보고 조정할
 * 화면 전환 규칙이다. 값이 없으면 처음에는 항상 하이브리드 안내형을 쓴다.
 */
export const DEFAULT_ADAPTIVE_SUPPORT_CONFIG: AdaptiveSupportConfig = {
  slowPressMs: 900,
  voiceHesitationMs: 4_500,
  quickBacktrackMs: 2_500,
  minSignalsBeforeChange: 5,
  simpleAtOrAbove: 0.55,
  standardAtOrBelow: 0.2,
  slowPressWeight: 0.35,
  backtrackWeight: 0.4,
  voiceHesitationWeight: 0.25,
};

interface AggregateSignals {
  interactions: number;
  slowPresses: number;
  quickBacktracks: number;
  voiceHesitations: number;
}

interface PersistedAdaptiveSupport {
  version: 1;
  asked: boolean;
  consented: boolean;
  level: SupportLevel;
  /** 사용자가 직접 고른 경우 행동 합계가 화면을 다시 바꾸지 않는다. */
  manualLevel: SupportLevel | null;
  signals: AggregateSignals;
}

export interface AdaptiveSupportValue {
  asked: boolean;
  consented: boolean;
  level: SupportLevel;
  manualLevel: SupportLevel | null;
  signals: Readonly<AggregateSignals>;
  grantConsent: () => void;
  declineConsent: () => void;
  setLevel: (level: SupportLevel) => void;
  useAutomaticLevel: () => void;
  forget: () => void;
  recordPress: (durationMs: number | undefined) => void;
  recordVoice: (durationMs: number) => void;
  recordMenuOpened: (menuId: string) => void;
  recordMenuClosed: (menuId: string | null) => void;
}

const AdaptiveSupportContext = createContext<AdaptiveSupportValue | null>(null);

const EMPTY_SIGNALS: AggregateSignals = {
  interactions: 0,
  slowPresses: 0,
  quickBacktracks: 0,
  voiceHesitations: 0,
};

function initialState(): PersistedAdaptiveSupport {
  return {
    version: 1,
    asked: false,
    consented: false,
    level: "guided",
    manualLevel: null,
    signals: { ...EMPTY_SIGNALS },
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function load(key: string): PersistedAdaptiveSupport {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as PersistedAdaptiveSupport;
    if (
      parsed.version !== 1 ||
      typeof parsed.asked !== "boolean" ||
      typeof parsed.consented !== "boolean"
    ) {
      return initialState();
    }
    // v1 초반 탭에는 manualLevel이 없었다. 같은 버전의 추가 필드라 기본값만 보충한다.
    const manualLevel =
      parsed.manualLevel === "simple" ||
      parsed.manualLevel === "guided" ||
      parsed.manualLevel === "standard"
        ? parsed.manualLevel
        : null;
    return { ...parsed, manualLevel };
  } catch {
    return initialState();
  }
}

function save(key: string, state: PersistedAdaptiveSupport): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    // 탭 메모리 상태는 계속 쓸 수 있다. 저장소 실패를 사용자 오류로 보이지 않는다.
  }
}

function score(signals: AggregateSignals, config: AdaptiveSupportConfig): number {
  if (signals.interactions === 0) return 0;
  return Math.min(
    1,
    (signals.slowPresses * config.slowPressWeight +
      signals.quickBacktracks * config.backtrackWeight +
      signals.voiceHesitations * config.voiceHesitationWeight) /
      signals.interactions,
  );
}

/** 한 번에 한 단계만 옮긴다. 화면이 관찰 하나로 급격히 바뀌지 않게 하는 안전장치다. */
function nextLevel(
  previous: SupportLevel,
  signals: AggregateSignals,
  config: AdaptiveSupportConfig,
): SupportLevel {
  if (signals.interactions < config.minSignalsBeforeChange) return previous;
  const value = score(signals, config);
  if (value >= config.simpleAtOrAbove) {
    return previous === "standard" ? "guided" : "simple";
  }
  if (value <= config.standardAtOrBelow) {
    return previous === "simple" ? "guided" : "standard";
  }
  return "guided";
}

export function AdaptiveSupportProvider({
  children,
  storageKey,
  config = DEFAULT_ADAPTIVE_SUPPORT_CONFIG,
}: {
  children: ReactNode;
  storageKey: string;
  config?: AdaptiveSupportConfig;
}) {
  const key = `${storageKey}:adaptive-support:v1`;
  const [state, setState] = useState<PersistedAdaptiveSupport>(() => load(key));
  const [openedAt, setOpenedAt] = useState<{ menuId: string; at: number } | null>(null);

  const update = useCallback(
    (change: (signals: AggregateSignals) => AggregateSignals) => {
      setState((previous) => {
        if (!previous.consented) return previous;
        const signals = change(previous.signals);
        const next = {
          ...previous,
          signals,
          level: previous.manualLevel ?? nextLevel(previous.level, signals, config),
        };
        save(key, next);
        return next;
      });
    },
    [config, key],
  );

  const grantConsent = useCallback(() => {
    setState((previous) => {
      const next = { ...previous, asked: true, consented: true };
      save(key, next);
      return next;
    });
  }, [key]);

  const declineConsent = useCallback(() => {
    const next = { ...initialState(), asked: true };
    setState(next);
    save(key, next);
  }, [key]);

  /** 직접 고르기는 행동 데이터를 모으지 않아도 쓸 수 있다. */
  const setLevel = useCallback(
    (level: SupportLevel) => {
      setState((previous) => {
        const next = { ...previous, asked: true, level, manualLevel: level };
        save(key, next);
        return next;
      });
    },
    [key],
  );

  const useAutomaticLevel = useCallback(() => {
    setState((previous) => {
      const next = {
        ...previous,
        manualLevel: null,
        level: previous.consented ? nextLevel(previous.level, previous.signals, config) : "guided",
      };
      save(key, next);
      return next;
    });
  }, [config, key]);

  const forget = useCallback(() => {
    setOpenedAt(null);
    setState(initialState());
    try {
      sessionStorage.removeItem(key);
    } catch {
      // 같은 이유로 무시한다.
    }
  }, [key]);

  const recordPress = useCallback(
    (durationMs: number | undefined) => {
      update((previous) => ({
        ...previous,
        interactions: previous.interactions + 1,
        slowPresses:
          previous.slowPresses + (durationMs !== undefined && durationMs >= config.slowPressMs ? 1 : 0),
      }));
    },
    [config.slowPressMs, update],
  );

  const recordVoice = useCallback(
    (durationMs: number) => {
      update((previous) => ({
        ...previous,
        interactions: previous.interactions + 1,
        voiceHesitations:
          previous.voiceHesitations + (durationMs >= config.voiceHesitationMs ? 1 : 0),
      }));
    },
    [config.voiceHesitationMs, update],
  );

  const recordMenuOpened = useCallback(
    (menuId: string) => {
      // 동의를 받기 전에는 메뉴 ID조차 적응 데이터로 잡지 않는다.
      if (state.consented) setOpenedAt({ menuId, at: now() });
    },
    [state.consented],
  );

  const recordMenuClosed = useCallback(
    (menuId: string | null) => {
      if (!openedAt || openedAt.menuId !== menuId) return;
      const quick = now() - openedAt.at <= config.quickBacktrackMs;
      setOpenedAt(null);
      update((previous) => ({
        ...previous,
        interactions: previous.interactions + 1,
        quickBacktracks: previous.quickBacktracks + (quick ? 1 : 0),
      }));
    },
    [config.quickBacktrackMs, openedAt, update],
  );

  const value = useMemo<AdaptiveSupportValue>(
    () => ({
      consented: state.consented,
      asked: state.asked,
      level: state.level,
      manualLevel: state.manualLevel,
      signals: state.signals,
      grantConsent,
      declineConsent,
      setLevel,
      useAutomaticLevel,
      forget,
      recordPress,
      recordVoice,
      recordMenuOpened,
      recordMenuClosed,
    }),
    [
      state,
      grantConsent,
      declineConsent,
      setLevel,
      useAutomaticLevel,
      forget,
      recordPress,
      recordVoice,
      recordMenuOpened,
      recordMenuClosed,
    ],
  );

  return <AdaptiveSupportContext.Provider value={value}>{children}</AdaptiveSupportContext.Provider>;
}

export function useAdaptiveSupport(): AdaptiveSupportValue {
  const value = useContext(AdaptiveSupportContext);
  if (!value) throw new Error("useAdaptiveSupport는 <AdaptiveSupportProvider> 안에서만 쓸 수 있습니다.");
  return value;
}

export function supportLevelText(level: SupportLevel): string {
  switch (level) {
    case "simple":
      return "완전 단순형";
    case "standard":
      return "일반 단순형";
    default:
      return "하이브리드 안내형";
  }
}
