import { useMinUI } from "./useMinUI.js";

/**
 * 화면 대비 스위치 (F17).
 *
 * <p>글씨 크기와 <b>나란히 두되 따로</b> 둔다. 크게 해도 안 보이는 사람과, 크기는
 * 괜찮은데 흐린 회색을 못 읽는 사람은 서로 다른 사람이다. 한 손잡이로 묶으면 둘 중
 * 하나는 필요 없는 것까지 받는다.
 *
 * <p>미리 보기를 안 만든다. 누르면 <b>지금 보고 있는 화면이 바로 바뀌는 것</b>이
 * 가장 좋은 미리 보기다 — 작은 견본 상자를 따로 그리면 그것이 또 하나의 읽을 거리가 된다.
 */
export function ContrastControl() {
  const { profile, setContrast } = useMinUI();
  const high = profile.contrast === "high";

  return (
    <div className="minui-contrast-control" role="group" aria-label="화면 대비">
      <button
        type="button"
        className="minui-contrast-button"
        aria-pressed={!high}
        onClick={() => setContrast("normal")}
      >
        보통
      </button>
      <button
        type="button"
        className="minui-contrast-button"
        aria-pressed={high}
        onClick={() => setContrast("high")}
      >
        진하게
      </button>
    </div>
  );
}
