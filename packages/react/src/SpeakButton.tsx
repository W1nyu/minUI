import { useMinUI } from "./useMinUI.js";

/**
 * 이 자리를 읽어 주는 버튼 (F16).
 *
 * <p><b>호스트가 읽어 주기를 안 넘겼으면 아무것도 그리지 않는다.</b> `assist`가 없을 때
 * 호출 경로 자체를 안 만드는 것과 같은 판단이다 — 눌러도 아무 일이 없는 버튼은 고장으로
 * 읽히고, 고장으로 읽히는 버튼이 하나 있으면 옆의 멀쩡한 버튼도 의심받는다.
 *
 * <p><b>읽을 글을 여기서 만들지 않는다.</b> 부르는 쪽이 문장을 넘긴다. 화면에 흩어진
 * `<dt>`/`<dd>`를 이 컴포넌트가 긁어모으게 하면, 화면 구조가 바뀔 때마다 읽어 주는 말이
 * 조용히 달라진다 — 확인 문구에서 그것은 사고다.
 *
 * <p>계좌번호를 통째로 읽지 않는 것은 <b>구현체가</b> 한다(`maskDigits`). 화면마다
 * 기억해야 하는 규칙으로 두면 한 화면이 잊는 순간 규칙이 없는 것과 같아진다.
 */

export interface SpeakButtonProps {
  /** 읽을 문장. 화면에 보이는 것과 같아야 한다. */
  text: string;
  /** 버튼에 붙는 이름. 무엇을 읽는지 밝힌다 — "읽어 주기"만으로는 무엇인지 모른다. */
  label: string;
}

export function SpeakButton({ text, label }: SpeakButtonProps) {
  const { tts } = useMinUI();
  if (!tts) return null;

  return (
    <button
      type="button"
      className="minui-speak"
      onClick={() => tts.speak(text)}
      aria-label={label}
    >
      {/*
        아이콘만 두지 않는다. 스피커 그림 하나는 "음소거"로도 읽히고, 무엇보다
        아이콘의 뜻은 배워야 아는 것이다. 이 앱의 사용자에게 그 배움을 요구하지 않는다.
      */}
      <span aria-hidden="true">🔊</span>
      <span className="minui-speak-text">읽어 주기</span>
    </button>
  );
}
