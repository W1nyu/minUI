import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * **AI 도우미를 시연 중에 껐다 켠다.**
 *
 * <p>이 저장소는 「AI가 없어도, 죽어도, 한도가 끊겨도 기본 경로가 그대로 돈다」를 여러
 * 번 적었고 두 가지 실패 모양으로 재기도 했다(기획안 §15). 그런데 <b>재는 것과 보여
 * 주는 것은 다르다</b> — 심사자는 그 표를 볼 수 없고, 말로 하는 주장은 확인할 수 없다.
 * 이 스위치가 그 주장을 눈앞에서 밟게 한다: 같은 질의, 같은 화면, AI만 빼고.
 *
 * <p><b>끄는 것은 중계기이지 기기 안의 것이 아니다.</b> 껐을 때도 로컬 검색·구워 둔
 * 뜻풀이 451개·안심 점검 여섯·다음 단계 안내는 그대로 돈다. 그 구분이 이 시연의
 * 요점이다 — "AI를 끄면 아무것도 안 된다"가 아니라 <b>"AI는 얹힌 것이고 바닥은 따로
 * 있다"</b>를 보여야 한다.
 *
 * <p>상태를 sessionStorage에 두는 이유는 화면을 옮겨 다녀도 유지돼야 하기 때문이다.
 * 탭을 닫으면 사라진다 — 시연 설정이 다음 사람에게 남을 이유가 없다.
 */

const KEY = "minui.demo.ai";

interface AiSwitchValue {
  /** 중계기를 쓸 것인가. */
  relay: boolean;
  setRelay: (on: boolean) => void;
}

const AiSwitchContext = createContext<AiSwitchValue | null>(null);

export function AiSwitchProvider({ children }: { children: ReactNode }) {
  const [relay, setRelayState] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) !== "off";
    } catch {
      // 저장소를 못 읽는 환경(사생활 보호 창)에서는 켜진 채로 시작한다.
      return true;
    }
  });

  const value = useMemo<AiSwitchValue>(
    () => ({
      relay,
      setRelay: (on) => {
        try {
          sessionStorage.setItem(KEY, on ? "on" : "off");
        } catch {
          // 못 써도 이번 화면은 바뀐다.
        }
        setRelayState(on);
      },
    }),
    [relay],
  );

  return <AiSwitchContext.Provider value={value}>{children}</AiSwitchContext.Provider>;
}

/**
 * 중계기를 쓸 것인가.
 *
 * <p>Provider 밖에서도 부를 수 있게 기본값을 켬으로 둔다 — 테스트가 화면 하나만
 * 떼어 렌더할 때 Provider를 세우게 만들면, 이 스위치가 없던 시절의 테스트가 전부 깨진다.
 */
export function useAiRelay(): boolean {
  return useContext(AiSwitchContext)?.relay ?? true;
}

/**
 * 진행자가 누르는 스위치.
 *
 * <p>켜져 있을 때는 조용하고, <b>꺼져 있을 때 눈에 띈다.</b> 연습 모드 배지와 같은
 * 판단이다 — 꺼 놓은 것을 잊고 "AI가 답을 못 한다"고 오해하는 것이 이 스위치가 만들 수
 * 있는 가장 나쁜 결과다.
 */
export function AiSwitch() {
  const context = useContext(AiSwitchContext);
  if (!context) return null;

  /*
   * **띠를 스스로 만들지 않는다.** 연습 스위치와 한 줄을 나눠 쓴다 — 진행자용 조절이
   * 둘인데 각자 줄을 차지하면 앱을 열자마자 머리 띠가 넷이 되고, 정작 카드가 화면
   * 아래로 밀린다. 「큰 카드 넉 장」이 첫 화면이라는 원칙 P1이 그렇게 조용히 깨진다.
   */
  if (context.relay) {
    return (
      <button type="button" className="demo-quiet" onClick={() => context.setRelay(false)}>
        AI 도우미 끄고 보기
      </button>
    );
  }

  return (
    <span className="demo-loud demo-loud-warn" role="status">
      <span className="demo-loud-text">
        <strong>AI 도우미 꺼짐</strong> — 이 기기 안의 것만으로 돕니다
      </span>
      <button type="button" className="demo-restore" onClick={() => context.setRelay(true)}>
        다시 켜기
      </button>
    </span>
  );
}
