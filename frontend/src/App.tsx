import type { MenuId, Slots } from "@minui/core";
import { assistEndpoint, makeAssist } from "@host-ai/assist.js";
import { makeClarify } from "@host-ai/clarify.js";
import { makeCorrect } from "@host-ai/correct.js";
import { makeExplain, makeGroundedHint } from "@host-ai/explain.js";
import { IndexedDbStorageAdapter, MinUIProvider, type SttLike } from "@minui/react";
import { useCallback, useId, useMemo, useState } from "react";
import { AiSwitch, AiSwitchProvider, useAiRelay } from "./AiSwitch.js";
import { BankProvider } from "./BankContext.js";
import { DemoLedgerNotice } from "./DemoLedgerNotice.js";
import { MockBankApi } from "./api/mockApi.js";
import { PracticeBankApi } from "./api/practiceApi.js";
import type { BankApi } from "./api/types.js";
import { CATALOG, COLD_START_PRESETS } from "./catalog.js";
import { FeedbackSheet } from "./FeedbackSheet.js";
import { useTaskRecorder } from "./instrumentation/TaskRecorder.js";
import { ClassicShell } from "./modes/ClassicShell.js";
import { MinUIShell } from "./modes/MinUIShell.js";
import { Screen } from "./screens/index.js";
import { useOptionalSession } from "./session/SessionContext.js";
import { makeTts } from "./tts.js";

export type Mode = "minui" | "classic";

/** 피드백이 어느 배포본에서 나왔는지 사용자도 함께 볼 수 있는 식별자. */
const RELEASE_ID = import.meta.env.VITE_RELEASE_ID ?? "public-demo";

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
   * <p>없으면 나가기 버튼 자체가 안 생긴다 — 사용자 개념 없이 `App`을 단독으로 그리는
   * 기존 테스트와 계측 대본이 그대로 돌아야 하기 때문이다.
   */
  onExit?: () => void;
}

/**
 * 바깥 껍데기. **AI 스위치가 여기 있어야 하는 이유**는 아래 capability들이 그 값에
 * 따라 <b>만들어지거나 안 만들어지기</b> 때문이다 — 스위치를 안쪽에 두면 스위치를
 * 읽는 훅이 capability를 만드는 자리보다 아래에 있게 된다.
 */
export function App(props: AppProps) {
  return (
    <AiSwitchProvider>
      <AppInner {...props} />
    </AiSwitchProvider>
  );
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  /**
   * 연습 모드 (F14). **기본은 꺼짐** — 시연은 진짜(가상 원장) 이체로 시작한다.
   *
   * <p>상태가 여기 있는 이유는 이것이 <b>어떤 API를 쓰는가</b>의 문제라서다. 화면
   * 어딘가의 표시가 아니라 데이터가 흐르는 경로 자체를 바꾸므로, 경로를 정하는 곳에서
   * 정해야 한 화면만 연습을 잊는 일이 안 생긴다.
   */
  const [practice, setPractice] = useState(false);
  /**
   * 중계기를 쓸 것인가 (시연 스위치). **끄면 아래 capability들이 아예 안 만들어진다.**
   *
   * <p>`undefined`를 넘기는 것과 만들어 놓고 안 부르는 것은 다르다 — 전자는 화면에
   * 그 상태 자체가 안 생기고, 후자는 "묻는 중"이 잠깐 떴다 사라진다. 이 저장소가
   * `assist`를 다루던 방식 그대로다.
   */
  const aiRelay = useAiRelay();
  const recorder = useTaskRecorder();

  const realApi = useMemo(() => api ?? new MockBankApi(), [api]);
  const bankApi = useMemo(
    () => (practice ? new PracticeBankApi(realApi) : realApi),
    [practice, realApi],
  );
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
    if (!aiRelay) return undefined;
    const endpoint = assistEndpoint();
    return endpoint ? makeAssist(CATALOG, endpoint) : undefined;
  }, [aiRelay]);

  /*
   * 「이해 지원」 — 뜻풀이를 비워 둔 여섯 메뉴에서 "이게 무슨 뜻이에요?"가 뜬다.
   *
   * 이 앱은 전에 `explain`을 아예 안 넘겼고, 그래서 그 버튼이 한 번도 안 떴다.
   * `makeExplain`은 배포에서는 미리 구워 둔 답을 조회하고, 로컬 개발에서는
   * `/api/explain`까지 간다 (`shared/host-ai/explain.ts`).
   *
   */
  /*
   * **끄더라도 구워 둔 451개는 그대로 나온다.** 캐시는 AI가 아니다 — 끄는 것은
   * 중계기이지 기기가 이미 가진 답이 아니고, 그 구분이 이 스위치의 요점이다.
   */
  const explain = useMemo(() => makeExplain(CATALOG, { relay: aiRelay }), [aiRelay]);
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
  const clarify = useMemo(() => (aiRelay ? makeClarify() : undefined), [aiRelay]);

  /*
   * 잘못 들린 말 고쳐 쓰기 (AI-6). 목적지를 고르지 않고 질의만 고치므로, 고쳐진 말은
   * 배운 말·자모 보정·위험도 경계를 그대로 지난다.
   */
  const correct = useMemo(() => (aiRelay ? makeCorrect(CATALOG) : undefined), [aiRelay]);

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
          {demoData && (
            <>
              <DemoLedgerNotice {...(resetDemoLedger ? { onReset: resetDemoLedger } : {})} />
              <a className="demo-back-link" href="../" data-demo-chrome="true">
                ← 이전 화면
              </a>
            </>
          )}
            <ModeSwitch mode={mode} onChange={setMode} />
            {/*
              진행자용 조절 한 줄. 연습 모드와 AI 스위치가 자리를 나눠 쓴다 —
              각자 줄을 차지하면 머리 띠가 넷이 되어 카드가 화면 아래로 밀린다.
            */}
            <div className="demo-bar">
              <PracticeSwitch practice={practice} onChange={setPractice} />
              <AiSwitch />
              {onExit && <SessionBar onExit={onExit} />}
            </div>
            <main className="app-body">
              {mode === "minui" ? <MinUIShell {...(stt ? { stt } : {})} /> : <ClassicShell />}
            </main>
            {/*
              의견 링크는 **스크롤 영역 밖**에 둔다 (F11).
              
              처음에는 `app-body` 안에 뒀는데, 홈이 자기 스크롤을 갖고 있어서 이 링크가
              카드 목록 한가운데를 가로막고 앉았다. 위의 `app-bar`·`practice-bar`와 같은
              자리다 — 화면의 <b>테두리</b>에 속하는 것은 내용과 함께 스크롤되면 안 된다.
            */}
            <button type="button" className="feedback-trigger" onClick={() => setFeedbackOpen(true)}>
              이 화면에 의견 남기기
            </button>
            {openMenuId && (
              <Screen
                menuId={openMenuId}
                prefill={prefill}
                onBack={() => setOpenMenuId(null)}
              />
            )}
        </div>
      </BankProvider>
      {feedbackOpen && <FeedbackSheet releaseId={RELEASE_ID} onClose={() => setFeedbackOpen(false)} />}
    </MinUIProvider>
  );
}

/**
 * 지금 누구로 보고 있는지와, 물러나는 문.
 *
 * <p>이름을 상시로 띄우는 이유는 연습 모드 배지와 같다 — 시연 중에 사람을 바꿔 가며
 * 보다 보면 <b>지금 누구인지를 잊는다.</b> 두 사람의 화면이 같은 모양이라 더 그렇다.
 */
function SessionBar({ onExit }: { onExit: () => void }) {
  const session = useOptionalSession();
  const switchId = useId();
  if (!session?.user) return null;

  const { user, users, viewAs } = session;

  return (
    <span className="demo-session">
      <span className="demo-session-who">
        <strong>{user.name}</strong>님으로 보는 중
      </span>
      {/*
        진행자용 빠른 전환. **나가기와 다른 물건이다.**

        나가기는 사용자가 쓰는 문이라 다시 들어올 때 번호를 묻는 것이 맞고, 이쪽은
        진행자가 사람을 갈아 끼우는 자리라 묻지 않는다. 시연 중 왕복이 잦은데 매번
        여섯 자리를 누르면 그 시간이 전부 대본 밖의 시간이 된다. 번호를 건너뛰어도
        잃는 것이 없다 — 애초에 지키는 것이 없다.

        `data-demo-chrome`은 이것이 MinUI가 얹히는 화면이 아니라 이 데모에만 있는
        진행 장치임을 DOM에 남긴다 (모드 스위치와 같은 표시).
      */}
      <label className="demo-session-switch" htmlFor={switchId}>
        <span className="demo-session-switch-label">진행자용 — 다른 사람으로 바로 보기</span>
        <select
          id={switchId}
          value={user.id}
          data-demo-chrome="true"
          onChange={(event) => viewAs(event.target.value)}
        >
          {users.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.group})
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="demo-quiet" onClick={onExit}>
        나가기
      </button>
    </span>
  );
}

/**
 * 연습 모드 스위치와 상시 배지 (F14).
 *
 * <p>켜져 있을 때 <b>화면에서 사라지지 않는</b> 것이 요점이다. 스위치만 두고 배지를
 * 안 두면, 연습으로 켜 놓은 것을 잊은 사람이 진짜로 보냈다고 믿는다 — 그것은 연습이
 * 만들 수 있는 가장 나쁜 결과다. 가상 원장 고지 띠와 <b>다른 자리</b>에 두는 이유도
 * 같다. 두 고지가 겹쳐 보이면 둘 다 배경이 된다.
 */
function PracticeSwitch({
  practice,
  onChange,
}: {
  practice: boolean;
  onChange: (practice: boolean) => void;
}) {
  if (!practice) {
    return (
      <button type="button" className="demo-quiet" onClick={() => onChange(true)}>
        연습해 보기 — 돈이 나가지 않아요
      </button>
    );
  }

  return (
    <span className="demo-loud demo-loud-accent" role="status">
      <span className="demo-loud-text">
        <strong>연습 중</strong> — 실제로 보내지지 않아요
      </span>
      <button type="button" className="demo-restore" onClick={() => onChange(false)}>
        연습 끝내기
      </button>
    </span>
  );
}

/**
 * 두 모드를 오가는 스위치.
 *
 * 실제 제품이라면 설정 화면 깊숙이 들어갈 물건이지만, 이 데모의 목적 자체가
 * **같은 기능을 두 UI로 비교하는 것**이라 가장 눈에 띄는 자리에 둔다.
 */
function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
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
    </header>
  );
}
