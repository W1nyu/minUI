import type { MenuId, Slots } from "@minui/core";
import { MENU_BY_ID } from "../catalog.js";
import { AccountsScreen } from "./AccountsScreen.js";
import { AutoTransferScreen } from "./AutoTransferScreen.js";
import { BalanceScreen } from "./BalanceScreen.js";
import { HistoryScreen } from "./HistoryScreen.js";
import { ScreenFrame } from "./ScreenFrame.js";
import { TransferScreen } from "./TransferScreen.js";

/**
 * 메뉴 ID → 화면.
 *
 * 25개 중 5개만 실제로 동작한다. 나머지는 스텁이다 — 기획안 §14가 "데모 앱이 커져
 * 엔진 개발이 밀리는" 리스크에 대해 M1 범위를 이체·조회·원장으로 못박은 결과다.
 *
 * 스텁 화면은 작업 완료(`complete`)를 기록하지 않는다. 들어갔다 그냥 나온 방문으로
 * 남는 것이 실제로 일어난 일이고, 랭킹도 그렇게 취급해야 맞다 (기획안 F1).
 */
export function Screen({
  menuId,
  prefill = {},
  onBack,
}: {
  menuId: MenuId;
  /** 음성이 데려온 값 (M9). 화면이 자기 도메인으로 해석한다. */
  prefill?: Slots;
  onBack: () => void;
}) {
  switch (menuId) {
    case "inquiry.balance":
      return <BalanceScreen onBack={onBack} />;
    case "inquiry.accounts":
      return <AccountsScreen onBack={onBack} />;
    case "inquiry.history":
      return <HistoryScreen onBack={onBack} />;
    case "transfer.account":
      return (
        <TransferScreen
          onBack={onBack}
          {...(typeof prefill["spoken"] === "string"
            ? { spoken: prefill["spoken"] }
            : {})}
        />
      );
    case "transfer.auto":
      return <AutoTransferScreen onBack={onBack} />;
    default:
      return <StubScreen menuId={menuId} onBack={onBack} />;
  }
}

function StubScreen({ menuId, onBack }: { menuId: MenuId; onBack: () => void }) {
  const menu = MENU_BY_ID.get(menuId);

  return (
    <ScreenFrame title={menu?.label ?? "화면"} onBack={onBack} menuId={menuId}>
      <p className="notice">
        이 데모에서는 <strong>{menu?.label}</strong> 화면을 만들지 않았습니다. 메뉴 탐색과
        카드 배치를 검증하는 것이 목적이라, 실제로 동작하는 화면은 잔액·계좌·이체·내역·자동이체
        다섯 개입니다.
      </p>
      <button type="button" className="primary-button" onClick={onBack}>
        돌아가기
      </button>
    </ScreenFrame>
  );
}
