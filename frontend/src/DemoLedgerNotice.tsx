import { useState } from "react";
import { useBank } from "./BankContext.js";

/**
 * 실제 금융 연동이 아닌 시연임을 계속 드러내고, 가상 원장을 안전하게 초기화한다.
 *
 * <p>초기화는 거래 결과를 되돌리는 기능이 아니라 테스트 데이터를 새로 여는 기능이다.
 * 그래서 한 번 더 묻는다. 로컬 백엔드 시연은 테스트 DB를 보존하므로 이 초기화 버튼을 넘기지 않는다.
 */
export function DemoLedgerNotice({ onReset }: { onReset?: () => void | Promise<void> }) {
  const { reload } = useBank();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reset() {
    await onReset?.();
    await reload();
    setConfirming(false);
    setMessage("가상 원장을 처음 상태로 되돌렸습니다.");
  }

  return (
    <aside
      className="demo-data-notice"
      aria-label="가상 오픈뱅킹 시연 안내"
      data-demo-chrome="true"
    >
      <p>
        <strong>가상 오픈뱅킹 시연</strong> — 테스트 계좌·OAuth 표기만 사용하며,
        실제 계좌·토큰·마이데이터는 연결하지 않습니다.
      </p>
      {onReset &&
        (confirming ? (
          <span className="demo-ledger-actions">
            <span>이 탭의 가상 거래를 모두 처음으로 되돌릴까요?</span>
            <button type="button" onClick={() => void reset()}>
              네, 초기화
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              아니요
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>
            가상 원장 초기화
          </button>
        ))}
      {message && <span role="status">{message}</span>}
    </aside>
  );
}
