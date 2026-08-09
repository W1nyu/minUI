import { useId, useState } from "react";
import { useBank } from "../BankContext.js";
import { ScreenFrame, formatWon } from "./ScreenFrame.js";

/**
 * 계좌 이체.
 *
 * 기획안 §9.3의 선이 여기서 보인다 — 음성이나 카드가 수취인을 미리 채워 줄 수는 있어도,
 * **금액 입력과 최종 확정은 언제나 이 화면에서 사람이 한다.**
 */
export function TransferScreen({ onBack }: { onBack: () => void }) {
  const { accounts, payees, complete, api, reload } = useBank();
  const [payeeId, setPayeeId] = useState(payees[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ payee: string; amount: number } | null>(null);
  const [sending, setSending] = useState(false);

  const payeeFieldId = useId();
  const amountFieldId = useId();
  const account = accounts[0];
  const payee = payees.find((p) => p.id === payeeId);

  async function send() {
    setError(null);
    const value = Number(amount.replace(/[^0-9]/g, ""));

    if (!account || !payee) {
      setError("보낼 계좌와 받는 분을 선택해 주세요.");
      return;
    }
    if (!value) {
      setError("보낼 금액을 입력해 주세요.");
      return;
    }

    setSending(true);
    try {
      // 멱등성 키. M1 백엔드에서 중복 이체를 막는 데 쓰인다.
      const result = await api.transfer(
        {
          fromAccountId: account.id,
          toBank: payee.bank,
          toNumber: payee.number,
          amount: value,
        },
        crypto.randomUUID(),
      );
      setDone({ payee: result.payee, amount: result.amount });
      complete("transfer.account");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이체하지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <ScreenFrame title="이체 완료" onBack={onBack}>
        <p className="notice" role="status">
          {done.payee}님께 {formatWon(done.amount)}을 보냈습니다.
        </p>
        <button type="button" className="primary-button" onClick={onBack}>
          확인
        </button>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame title="계좌 이체" onBack={onBack}>
      <p className="field-note">
        보낼 통장: {account?.nickname} ({formatWon(account?.balance ?? 0)})
      </p>

      <label className="field-label" htmlFor={payeeFieldId}>
        받는 분
      </label>
      <select
        id={payeeFieldId}
        className="field"
        value={payeeId}
        onChange={(event) => setPayeeId(event.target.value)}
      >
        {payees.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.bank} {p.number})
          </option>
        ))}
      </select>

      <label className="field-label" htmlFor={amountFieldId}>
        보낼 금액
      </label>
      <input
        id={amountFieldId}
        className="field"
        inputMode="numeric"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="예: 187000"
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="primary-button"
        onClick={() => void send()}
        disabled={sending}
      >
        {sending ? "보내는 중" : "보내기"}
      </button>
    </ScreenFrame>
  );
}
