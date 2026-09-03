import { useBank } from "./BankContext.js";

/**
 * 실제 금융 연동이 아닌 시연임을 계속 드러내고, 가상 원장을 안전하게 초기화한다.
 *
 * <p>초기화는 거래 결과를 되돌리는 기능이 아니라 테스트 데이터를 새로 여는 기능이다.
 * 그래서 한 번 더 묻는다. 로컬 백엔드 시연은 테스트 DB를 보존하므로 이 초기화 버튼을 넘기지 않는다.
 */
export function DemoLedgerNotice({
  onReset,
  onComplete,
}: {
  onReset?: () => void | Promise<void>;
  /** 모바일 시연 도구를 열어 초기화했으면, 끝난 뒤 다시 접는다. */
  onComplete?: () => void;
}) {
  const { reload } = useBank();

  async function reset() {
    if (!window.confirm("가상 원장을 초기화할까요?")) return;
    await onReset?.();
    await reload();
    onComplete?.();
  }

  if (!onReset) return null;

  return <button type="button" className="demo-data-notice" onClick={() => void reset()}>가상 원장 초기화</button>;
}
