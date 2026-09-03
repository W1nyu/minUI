import type { MenuId, Slots } from "@minui/core";
import { assistEndpoint, makeAssist } from "@host-ai/assist.js";
import { makeClarify } from "@host-ai/clarify.js";
import { makeCorrect } from "@host-ai/correct.js";
import { makeExplain, makeGroundedHint } from "@host-ai/explain.js";
import { IndexedDbStorageAdapter, MinUIProvider, type SttLike } from "@minui/react";
import type { ReactNode } from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { BankProvider } from "./BankContext.js";
import { DemoLedgerNotice } from "./DemoLedgerNotice.js";
import { MockBankApi } from "./api/mockApi.js";
import type { BankApi } from "./api/types.js";
import { CATALOG, COLD_START_PRESETS } from "./catalog.js";
import { useTaskRecorder } from "./instrumentation/TaskRecorder.js";
import { ClassicShell } from "./modes/ClassicShell.js";
import { MinUIShell } from "./modes/MinUIShell.js";
import { Screen } from "./screens/index.js";
import { makeTts } from "./tts.js";

export type Mode = "minui" | "classic";

export interface AppProps {
  /** 테스트와 M1 백엔드 교체를 위한 주입 지점. */
  api?: BankApi;
  initialMode?: Mode;
  storageKey?: string;
  /**
   * 음성 Provider 주입. 실제 실행에서는 MinUIShell이 Web Speech를 쓰고,
   * 측정에서는 스크립트된 발화를 넣어 마이크 없이 음성 경로를 잰다.
   */
  stt?: SttLike;

  /**
   * 계정계 없이 브라우저 안의 목으로 돌고 있는가.
   *
   * <p>참이면 화면 맨 위에 상시 띠를 띄운다. 배포한 데모에는 Spring Boot가 없어서
   * 이체가 이 브라우저 안에서만 일어나는데, 그것을 말하지 않으면 심사위원이
   * 무엇을 보고 있는지 알 수 없다. 기본값은 거짓 — 테스트는 지금까지처럼 조용하다.
   */
  demoData?: boolean;
  /** 가상 원장 초기화. 정적 시연에서만 넘긴다. */
  resetDemoLedger?: () => void | Promise<void>;
  /**
   * 로그인 화면으로 물러나기.
   *
   * <p>없으면 계정 로그아웃 버튼 자체가 안 생긴다 — 사용자 개념 없이 `App`을 단독으로 그리는
   * 기존 테스트와 계측 대본이 그대로 돌아야 하기 때문이다.
   */
  onExit?: () => void;
}

export function App(props: AppProps) {
  return <AppInner {...props} />;
}

function AppInner({
  api,
  initialMode = "minui",
  storageKey = "demo",
  stt,
  demoData = false,
  resetDemoLedger,
  onExit,
}: AppProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [openMenuId, setOpenMenuId] = useState<MenuId | null>(null);
  const [prefill, setPrefill] = useState<Slots>({});
  const recorder = useTaskRecorder();

  const bankApi = useMemo(() => api ?? new MockBankApi(), [api]);
  const storage = useMemo(() => new IndexedDbStorageAdapter(storageKey), [storageKey]);

  /**
   * 이식 계약 ② — 엔진이 메뉴 ID를 넘기면 호스트가 화면을 연다.
   * 호스트가 제공할 것은 이 함수 하나가 전부다.
   *
   * 계측이 여기 붙는 것은 우연이 아니다. 두 모드가 모두 이 한 경로로 화면을 열기 때문에,
   * 여기서 세면 어느 모드에서 무엇을 열었는지 빠짐없이 같은 기준으로 기록된다.
   */
  const openScreen = useCallback(
    (menuId: MenuId, params?: Record<string, unknown>) => {
      recorder.screen(menuId);
      setPrefill(params ?? {});
      setOpenMenuId(menuId);
    },
    [recorder],
  );

  /**
   * 이식 계약 ④ (선택) — 발화를 어느 화면이 받을지 **호스트가 정한다** (M9, §9.3).
   *
   * <p>여기서 값을 뽑지 않고 발화를 그대로 넘긴다. 수취인 목록을 아는 것은 그 화면이고,
   * 엔진은 물론 이 파일도 그것을 알 필요가 없다. 이 함수가 하는 유일한 판단은
   * <b>어느 메뉴가 사용자의 말을 받아도 되는가</b>이다 — 모든 화면에 발화를 흘리면
   * 필요 없는 곳까지 사용자가 한 말이 닿는다.
   *
   * <p>엔진은 이 값을 §9.3이 허용한 전이에만 싣는다. `riskLevel: high`인 이체 화면은
   * 사용자가 후보를 탭한 <b>뒤에</b> 받는다.
   */
  const slots = useCallback(
    (query: string, menuId: MenuId): Slots =>
      menuId === "transfer.account" ? { spoken: query } : {},
    [],
  );

  /*
   * 도우미 (AI-2). **중계기 주소가 있을 때만 만든다.**
   *
   * 전에는 여기서 `assist`를 아예 안 넘겼다. 정적 배포에 중계가 없어 항상 null이 되는데,
   * 그러면 되묻기 화면이 잠깐 떴다가 아무 일도 안 일어나는 것을 기다리게 되기 때문이었다.
   * 이제 중계기를 띄웠으므로 **주소가 있으면** 넘긴다 — 없으면 그때와 똑같이 안 넘긴다.
   * 판단이 바뀐 것이 아니라 조건이 생긴 것이다.
   */
  const assist = useMemo(() => {
    const endpoint = assistEndpoint();
    return endpoint ? makeAssist(CATALOG, endpoint) : undefined;
  }, []);

  /*
   * 「이해 지원」 — 뜻풀이를 비워 둔 여섯 메뉴에서 "이게 무슨 뜻이에요?"가 뜬다.
   *
   * 이 앱은 전에 `explain`을 아예 안 넘겼고, 그래서 그 버튼이 한 번도 안 떴다.
   * `makeExplain`은 배포에서는 미리 구워 둔 답을 조회하고, 로컬 개발에서는
   * `/api/explain`까지 간다 (`shared/host-ai/explain.ts`).
   *
   */
  const explain = useMemo(() => makeExplain(CATALOG), []);
  const grounded = useMemo(() => makeGroundedHint(CATALOG), []);

  /*
   * 읽어 주기 (F16). 브라우저가 지원하지 않으면 Provider가 스스로 `undefined`로 접고,
   * 그러면 읽기 버튼이 화면에 아예 생기지 않는다.
   */
  const tts = useMemo(() => makeTts(), []);

  /*
   * 한 문장 되묻기 (AI-3). 중계기가 없으면 `undefined`라 넘기지 않고, 그러면
   * 지금까지의 갈래 되묻기가 그대로 답이 된다.
   */
  const clarify = useMemo(() => makeClarify(), []);

  /*
   * 잘못 들린 말 고쳐 쓰기 (AI-6). 목적지를 고르지 않고 질의만 고치므로, 고쳐진 말은
   * 배운 말·자모 보정·위험도 경계를 그대로 지난다.
   */
  const correct = useMemo(() => makeCorrect(CATALOG), []);

  return (
    <MinUIProvider
      catalog={CATALOG}
      onAction={openScreen}
      slots={slots}
      storage={storage}
      coldStartPresets={COLD_START_PRESETS}
      explain={explain}
      groundedHint={grounded}
      tts={tts}
      {...(assist ? { assist } : {})}
      {...(clarify ? { clarify } : {})}
      {...(correct ? { correct } : {})}
      fallback={<p className="loading">불러오는 중…</p>}
    >
      <BankProvider api={bankApi}>
        <div className="app" data-mode={mode}>
            <ModeSwitch
              mode={mode}
              onChange={setMode}
              demoTools={
                demoData || onExit
                  ? <DemoTools {...(resetDemoLedger ? { onReset: resetDemoLedger } : {})} {...(onExit ? { onExit } : {})} />
                  : undefined
              }
            />
            <main className="app-body">
              {mode === "minui" ? <MinUIShell {...(stt ? { stt } : {})} /> : <ClassicShell />}
            </main>
            {openMenuId && (
              <Screen
                menuId={openMenuId}
                prefill={prefill}
                onBack={() => setOpenMenuId(null)}
              />
            )}
        </div>
      </BankProvider>
    </MinUIProvider>
  );
}

/**
 * 시연에만 필요한 원장 초기화·계정 로그아웃·나가기 도구.
 *
 * <p>넓은 화면에서는 프레임 밖에 항상 두고, 좁은 화면에서는 48px 햄버거 하나만 남긴다.
 * 펼친 뒤에만 메뉴가 앱 위에 놓여 홈 카드와 이체 흐름을 평소에는 가리지 않는다.
 */
function DemoTools({
  onReset,
  onExit,
}: {
  onReset?: () => void | Promise<void>;
  onExit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <nav
      className="demo-tools"
      aria-label="시연 도구"
      data-demo-chrome="true"
      data-open={open}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="demo-tools-toggle"
        aria-label={open ? "시연 도구 닫기" : "시연 도구 열기"}
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div className="demo-tools-list" id={menuId}>
        <DemoLedgerNotice
          {...(onReset ? { onReset } : {})}
          onComplete={() => setOpen(false)}
        />
        {onExit && (
          <button
            type="button"
            className="demo-logout"
            onClick={() => {
              setOpen(false);
              onExit();
            }}
          >
            계정 로그아웃
          </button>
        )}
        <a className="demo-back-link" href="../" data-demo-chrome="true">
          가상 이체 나가기
        </a>
      </div>
    </nav>
  );
}

/**
 * 두 모드를 오가는 스위치.
 *
 * 실제 제품이라면 설정 화면 깊숙이 들어갈 물건이지만, 이 데모의 목적 자체가
 * **같은 기능을 두 UI로 비교하는 것**이라 가장 눈에 띄는 자리에 둔다.
 */
function ModeSwitch({
  mode,
  onChange,
  demoTools,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  demoTools?: ReactNode;
}) {
  return (
    <header className="app-bar">
      <p className="app-bar-title">
        미니 은행 <span>데모</span>
      </p>
      {/*
        진행자용 대조 스위치다 — MinUI가 얹히는 화면이 아니라 두 UI를 비교하려고
        이 데모에만 둔 것이다. 접근성 측정에서 88px 기준을 적용하지 않는 이유를
        DOM에도 남긴다 (`services/smoke/src/a11y.ts`).
      */}
      <div
        className="mode-switch"
        role="group"
        aria-label="화면 방식"
        data-demo-chrome="true"
      >
        <button
          type="button"
          aria-pressed={mode === "classic"}
          onClick={() => onChange("classic")}
        >
          기본 UI
        </button>
        <button
          type="button"
          aria-pressed={mode === "minui"}
          onClick={() => onChange("minui")}
        >
          쉬운 모드
        </button>
      </div>
      {demoTools}
    </header>
  );
}
