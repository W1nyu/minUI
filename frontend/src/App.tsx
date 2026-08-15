import type { MenuId, Slots } from "@minui/core";
import { IndexedDbStorageAdapter, MinUIProvider, type SttLike } from "@minui/react";
import { useCallback, useMemo, useState } from "react";
import { BankProvider } from "./BankContext.js";
import { MockBankApi } from "./api/mockApi.js";
import type { BankApi } from "./api/types.js";
import { CATALOG, COLD_START_PRESETS } from "./catalog.js";
import { useTaskRecorder } from "./instrumentation/TaskRecorder.js";
import { ClassicShell } from "./modes/ClassicShell.js";
import { MinUIShell } from "./modes/MinUIShell.js";
import { Screen } from "./screens/index.js";

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
}

export function App({ api, initialMode = "minui", storageKey = "demo", stt }: AppProps) {
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

  return (
    <MinUIProvider
      catalog={CATALOG}
      onAction={openScreen}
      slots={slots}
      storage={storage}
      coldStartPresets={COLD_START_PRESETS}
      fallback={<p className="loading">불러오는 중…</p>}
    >
      <BankProvider api={bankApi}>
        <div className="app" data-mode={mode}>
          <ModeSwitch mode={mode} onChange={setMode} />
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
      <div className="mode-switch" role="group" aria-label="화면 방식">
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
