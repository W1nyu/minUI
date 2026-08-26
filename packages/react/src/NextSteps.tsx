import { nextSteps, type MenuCatalog, type MenuId } from "@minui/core";
import { useMemo } from "react";
import { useMinUI } from "./useMinUI.js";

/**
 * 지금 화면에서 **이어서 할 수 있는 것** (M12).
 *
 * <p>고령 사용자가 막히는 자리는 둘이다. 하나는 "어디를 눌러야 하는지 모르겠다"이고
 * 카드와 음성이 그것을 푼다. 다른 하나는 <b>도착한 뒤</b>다 — 화면에 왔는데 여기서
 * 무엇을 할 수 있는지, 옆에 무엇이 있는지 모른다. 돌아가려면 전체 메뉴를 다시 열어야 한다.
 *
 * <p><b>여기에 모델이 없다.</b> 답이 카탈로그 안에 이미 있고, 결정론이면 같은 화면에서
 * 늘 같은 것이 나온다. 고령 사용자에게 화면이 매번 달라지는 것은 도움이 아니라 벽이다.
 * `nextSteps`가 고르는 규칙은 하나 — 같은 2단 갈래의 형제(`packages/core/src/copilot.ts`).
 *
 * <p>형제가 없으면 <b>아무것도 그리지 않는다.</b> 자리를 채우려고 관계 없는 메뉴를 넣으면
 * 그것이 다음 단계인 척하고, 그 순간 이 영역은 또 하나의 메뉴판이 된다.
 *
 * <p>위험도는 그대로 실려 온다. `needsConfirm`인 메뉴도 여기서는 <b>누르면 열린다</b> —
 * 누르는 것이 곧 확인이기 때문이다(§9.3이 막는 것은 <b>자동</b> 실행이다). 다만 그 사실이
 * 보이게 표시한다.
 */

export interface NextStepsProps {
  catalog: MenuCatalog;
  /** 지금 열려 있는 화면. */
  menuId: MenuId;
  /** 몇 개까지. 많으면 그 자체가 또 하나의 메뉴판이 된다. */
  limit?: number;
}

export function NextSteps({ catalog, menuId, limit }: NextStepsProps) {
  const { open } = useMinUI();

  const steps = useMemo(
    () => nextSteps({ catalog, menuId, ...(limit !== undefined ? { limit } : {}) }),
    [catalog, menuId, limit],
  );

  if (steps.length === 0) return null;

  return (
    <nav className="minui-next-steps" aria-labelledby="minui-next-steps-title">
      <p className="minui-next-steps-title" id="minui-next-steps-title">
        이어서 하실 수 있어요
      </p>
      <ul className="minui-next-steps-list">
        {steps.map((step) => (
          <li key={step.menuId}>
            <button
              type="button"
              className="minui-next-step"
              onClick={() => open(step.menuId)}
            >
              <span className="minui-next-step-label">{step.label}</span>
              {step.needsConfirm && (
                /*
                 * 점이나 색이 아니라 글자다. 색만으로 알리면 색을 못 보는 사람에게는
                 * 아무것도 알린 것이 아니다 — 카드의 "새로 왔어요"와 같은 판단.
                 */
                <span className="minui-next-step-note">눌러서 확인</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
