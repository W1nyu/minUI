import type { TextScale } from "@minui/core";
import { useMinUI } from "./useMinUI.js";

const OPTIONS: { value: TextScale; label: string; aria: string }[] = [
  { value: "normal", label: "가", aria: "글씨 크기 보통" },
  { value: "large", label: "가", aria: "글씨 크기 크게" },
  { value: "xlarge", label: "가", aria: "글씨 크기 아주 크게" },
];

/**
 * 글씨 크기 3단계 (기획안 F5 질문 2).
 *
 * 버튼 글자는 "가" 하나뿐이지만, 각 버튼의 크기 자체가 결과를 미리 보여준다.
 * 화면에 읽히는 이름은 aria-label이 담당하므로 "아이콘만 있는 버튼"에는 해당하지 않는다.
 */
export function TextScaleControl() {
  const { profile, setTextScale } = useMinUI();

  return (
    <div className="minui-scale-control" role="group" aria-label="글씨 크기">
      {OPTIONS.map((option, index) => (
        <button
          key={option.value}
          type="button"
          className="minui-scale-button"
          aria-pressed={profile.textScale === option.value}
          aria-label={option.aria}
          onClick={() => setTextScale(option.value)}
          style={{ fontSize: `${1 + index * 0.28}rem` }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
