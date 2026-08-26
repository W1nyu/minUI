import type { TextScale, UsageIntent } from "@minui/core";
import { useEffect, useRef, useState } from "react";
import { useMinUI } from "./useMinUI.js";

/**
 * 온보딩 2문항 (기획안 F5).
 *
 * <p>엔진에는 `ColdStartProfile`도 `coldStartCards`도 프리셋도 처음부터 있었는데
 * <b>이것을 부르는 화면이 없었다</b> — `setProfile`의 호출자가 저장소 전체에 0이었다.
 * 그래서 모든 사용자가 기본값 `inquiry`로 시작했고, F5가 설계한 "첫 화면이 이미
 * 내 것이다"가 한 번도 일어나지 않았다.
 *
 * <p><b>왜 두 문항인가.</b> 세 문항째부터는 온보딩 자체가 넘어야 할 벽이 된다.
 * 이 앱이 없애려는 것이 바로 그 벽이다. 그래서 묻는 것은 카드 넉 장을 정하는 데
 * 실제로 쓰이는 둘뿐이고, 둘 다 <b>건너뛸 수 있다.</b>
 *
 * <p><b>왜 되돌릴 수 있는가.</b> 여기서 고른 것은 잠그는 결정이 아니라 출발점이다.
 * 이후 히스테리시스가 하루 한 장씩 실제 사용 기반으로 바꿔 나가고(`coldStart.ts`),
 * 무엇이 왜 거기 있는지는 「왜 이렇게 보이나요」가 언제든 답한다. 잘못 골라도
 * 되돌아올 길이 있다는 것이 고령 사용자에게 물어도 되는 조건이다.
 *
 * <p>언제 띄울지는 <b>호스트가 정한다.</b> 이 컴포넌트는 상태를 저장하지 않는다 —
 * 엔진 상태(`STATE_VERSION`)를 건드리지 않기 위해서다.
 */

export interface OnboardingSheetProps {
  /** 두 문항을 다 지나거나 건너뛰었을 때. 호스트가 "봤다"를 기록한다. */
  onDone: () => void;
}

const INTENTS: { value: UsageIntent; label: string; detail: string }[] = [
  { value: "inquiry", label: "얼마 있는지 봐요", detail: "잔액과 들어온 돈을 자주 확인해요" },
  { value: "transfer", label: "돈을 보내요", detail: "이체와 자동이체를 자주 써요" },
  { value: "invest", label: "모으고 불려요", detail: "예금·적금과 투자를 봐요" },
];

const SCALES: { value: TextScale; label: string; size: string }[] = [
  { value: "normal", label: "보통", size: "1.15rem" },
  { value: "large", label: "크게", size: "1.45rem" },
  { value: "xlarge", label: "아주 크게", size: "1.95rem" },
];

export function OnboardingSheet({ onDone }: OnboardingSheetProps) {
  const { profile, setProfile } = useMinUI();
  const [step, setStep] = useState<1 | 2>(1);
  const headingRef = useRef<HTMLHeadingElement>(null);

  /*
   * 문항이 바뀔 때마다 제목으로 포커스를 옮긴다. 시트가 열릴 때 닫기 버튼을 잡는
   * 다른 시트들과 다른 이유: 여기에는 닫기 버튼이 없고, 스크린리더 사용자가
   * "질문이 바뀌었다"를 알 방법이 제목뿐이다.
   */
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const chooseIntent = (intent: UsageIntent) => {
    setProfile({ ...profile, intent });
    setStep(2);
  };

  const chooseScale = (textScale: TextScale) => {
    // profile을 다시 읽지 않고 intent를 그대로 쓴다 — 1문항에서 방금 넣은 값이
    // 아직 이 렌더에 안 반영됐을 수 있다.
    setProfile({ ...profile, textScale });
    onDone();
  };

  return (
    <div
      className="minui-sheet minui-onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="minui-onboarding-title"
    >
      <div className="minui-sheet-body">
        <p className="minui-onboarding-step">{step}번째 질문 · 모두 2개</p>
        <h2
          className="minui-sheet-title"
          id="minui-onboarding-title"
          ref={headingRef}
          tabIndex={-1}
        >
          {step === 1 ? "은행 앱에서 주로 무엇을 하세요?" : "글씨는 이 정도면 될까요?"}
        </h2>

        {step === 1 ? (
          <ul className="minui-onboarding-list">
            {INTENTS.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className="minui-onboarding-choice"
                  onClick={() => chooseIntent(option.value)}
                >
                  <span className="minui-onboarding-choice-label">{option.label}</span>
                  <span className="minui-onboarding-choice-detail">{option.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="minui-onboarding-list">
            {SCALES.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className="minui-onboarding-choice"
                  onClick={() => chooseScale(option.value)}
                >
                  {/* 버튼 안의 글자 크기가 곧 결과다. 설명하지 않고 보여 준다. */}
                  <span
                    className="minui-onboarding-choice-label"
                    style={{ fontSize: option.size }}
                  >
                    {option.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="minui-onboarding-skip" onClick={onDone}>
          건너뛰기
        </button>
        <p className="minui-onboarding-note">
          나중에 바꿀 수 있어요. 화면은 쓰실수록 알아서 맞춰집니다.
        </p>
      </div>
    </div>
  );
}
