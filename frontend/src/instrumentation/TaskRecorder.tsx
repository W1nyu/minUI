import type { MenuId } from "@minui/core";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Mode } from "../App.js";

/**
 * 과제 수행 계측 (기획안 §12.2-A).
 *
 * <p>같은 참가자가 두 UI 모드로 같은 과제를 수행할 때 시간·탭 수를 자동으로 기록한다.
 * 손으로 세면 관찰자가 놓치고, 놓친 것이 어느 쪽에 유리하게 놓쳤는지 알 수 없다.
 *
 * <p>여기서 재는 네 가지는 §12.1의 1차 지표와 하나씩 대응한다.
 * <ul>
 *   <li>{@code elapsedMs} — 태스크 완료 시간
 *   <li>{@code taps} — 탭 횟수
 *   <li>{@code completed} — 완료율
 *   <li>{@code offTarget} — 오탐색률 (목표와 무관한 화면에 들어간 횟수)
 * </ul>
 *
 * <p><b>상태를 React state가 아니라 ref에 둔다.</b> 계측이 state를 바꾸면 측정 대상 앱이
 * 매 탭마다 리렌더된다 — 재려는 것을 재는 행위가 바꿔 버리는 셈이다. 게다가 기록을
 * 읽는 쪽은 렌더 사이클을 기다려야 해서 방금 끝난 과제가 아직 안 보이기도 한다.
 * ref로 두면 둘 다 없다.
 */

export interface TaskRun {
  taskId: string;
  mode: Mode;
  /** 이 과제가 도달해야 하는 메뉴. */
  targetMenuId: MenuId;
  startedAt: number;
  endedAt: number | null;
  elapsedMs: number | null;
  taps: number;
  /** 연 화면들을 순서대로. 어디서 헤맸는지가 여기 남는다. */
  screens: MenuId[];
  /** 목표와 무관한 화면에 들어간 횟수. */
  offTarget: number;
  completed: boolean;
}

export interface RecorderValue {
  /** 과제 시작. 이미 진행 중이면 그것을 미완료로 닫고 새로 연다. */
  begin: (taskId: string, targetMenuId: MenuId, mode: Mode) => void;
  /** 화면 진입. 호스트의 ActionHandler 경로에서 불린다. */
  screen: (menuId: MenuId) => void;
  /** 과제 완료. 목표 화면에서 온 완료만 인정한다. */
  finish: (menuId: MenuId) => TaskRun | null;
  /** 진행 중인 과제를 미완료로 닫는다. */
  abandon: () => TaskRun | null;
  getRuns: () => TaskRun[];
  getCurrent: () => TaskRun | null;
  reset: () => void;
  toJSON: () => string;
}

const RecorderContext = createContext<RecorderValue | null>(null);

/** 탭으로 셀 요소. 빈 곳을 눌러도 탭 수가 늘면 측정이 부풀려진다. */
const TAPPABLE = "button, a, input, select, textarea, [role='button']";

export function TaskRecorderProvider({
  children,
  now = () => Date.now(),
}: {
  children: ReactNode;
  /** 테스트에서 시간을 고정하기 위한 주입 지점. */
  now?: () => number;
}) {
  const currentRef = useRef<TaskRun | null>(null);
  const runsRef = useRef<TaskRun[]>([]);
  const nowRef = useRef(now);
  nowRef.current = now;

  const value = useMemo<RecorderValue>(() => {
    const close = (completed: boolean): TaskRun | null => {
      const run = currentRef.current;
      if (!run) return null;

      const at = nowRef.current();
      const finished: TaskRun = {
        ...run,
        endedAt: at,
        elapsedMs: at - run.startedAt,
        completed,
      };
      runsRef.current.push(finished);
      currentRef.current = null;
      return finished;
    };

    return {
      begin: (taskId, targetMenuId, mode) => {
        if (currentRef.current) close(false);
        currentRef.current = {
          taskId,
          mode,
          targetMenuId,
          startedAt: nowRef.current(),
          endedAt: null,
          elapsedMs: null,
          taps: 0,
          screens: [],
          offTarget: 0,
          completed: false,
        };
      },

      screen: (menuId) => {
        const run = currentRef.current;
        if (!run) return;
        run.screens.push(menuId);
        if (menuId !== run.targetMenuId) run.offTarget += 1;
      },

      finish: (menuId) => {
        const run = currentRef.current;
        // 목표가 아닌 화면에서의 완료는 이 과제의 완료가 아니다.
        if (!run || menuId !== run.targetMenuId) return null;
        return close(true);
      },

      abandon: () => close(false),
      getRuns: () => [...runsRef.current],
      getCurrent: () => currentRef.current,
      reset: () => {
        currentRef.current = null;
        runsRef.current = [];
      },
      toJSON: () => JSON.stringify(runsRef.current, null, 2),
    };
  }, []);

  /**
   * 탭은 문서 전체에서 캡처 단계로 센다.
   *
   * <p>각 버튼에 핸들러를 다는 방법도 있지만, 그러면 계측을 위해 제품 코드를 고치게 되고
   * 어느 버튼을 빠뜨렸는지 알 수 없다. 여기서 한 번에 세면 새 버튼이 생겨도 자동으로 잡힌다.
   */
  useEffect(() => {
    const onPointerDown = (event: Event) => {
      const run = currentRef.current;
      if (!run) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(TAPPABLE)) return;
      run.taps += 1;
    };

    // pointerdown만 듣는다. click까지 함께 들으면 한 번의 탭이 두 번으로 세진다.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

/** 계측이 꺼져 있어도 화면은 동작해야 한다. Provider가 없으면 아무것도 하지 않는다. */
export function useTaskRecorder(): RecorderValue {
  return useContext(RecorderContext) ?? NOOP;
}

const NOOP: RecorderValue = {
  begin: () => {},
  screen: () => {},
  finish: () => null,
  abandon: () => null,
  getRuns: () => [],
  getCurrent: () => null,
  reset: () => {},
  toJSON: () => "[]",
};
