import { useBank } from "../BankContext.js";
import { ScreenFrame, formatWon } from "./ScreenFrame.js";

/**
 * 자동이체 관리 — 기획안 S3의 목적지.
 *
 * "자동이체 안 나가게 해야 하는데"라는 발화가 도달해야 하는 화면이고,
 * 기본 UI 모드에서는 전체메뉴 → 이체·출금 → 자동이체 → 조회/해지로 네 번을 눌러야 한다.
 */
export function AutoTransferScreen({ onBack }: { onBack: () => void }) {
  const { autoTransfers, setAutoTransferActive, complete } = useBank();

  return (
    <ScreenFrame title="자동이체 관리" onBack={onBack} menuId="transfer.auto">
      <ul className="auto-list">
        {autoTransfers.map((item) => (
          <li className="auto" key={item.id}>
            <span className="auto-payee">{item.payee}</span>
            <span className="auto-when">매월 {item.dayOfMonth}일</span>
            <strong className="auto-amount">{formatWon(item.amount)}</strong>
            <button
              type="button"
              className="auto-toggle"
              aria-pressed={item.active}
              onClick={() => {
                void setAutoTransferActive(item.id, !item.active);
                complete("transfer.auto");
              }}
            >
              {item.active ? "그만 내기" : "다시 내기"}
            </button>
            <span className="auto-state" data-active={item.active}>
              {item.active ? "매달 나가는 중" : "멈춤"}
            </span>
          </li>
        ))}
      </ul>
    </ScreenFrame>
  );
}
