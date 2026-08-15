import { parseAmount, pickFromList } from "@minui/core";
import { useId, useMemo, useState } from "react";
import { useBank } from "../BankContext.js";
import { ScreenFrame, formatWon } from "./ScreenFrame.js";

/**
 * 계좌 이체.
 *
 * 기획안 §9.3의 선이 **이 파일에서 실제로 그어진다** — 음성이 수취인을 미리 채워 줄 수는
 * 있어도, 금액 입력과 최종 확정은 언제나 여기서 사람이 한다.
 */
export function TransferScreen({
  onBack,
  spoken,
}: {
  onBack: () => void;
  /** 음성으로 열렸다면 사용자가 한 말 (M9). 도메인 해석은 이 화면이 한다. */
  spoken?: string;
}) {
  const { accounts, payees, complete, api, reload } = useBank();

  /*
   * **수취인은 미리 고른다** — §9.3이 "최근 수취인 프리필"을 음성으로 가능한 쪽에 뒀다.
   * 목록에 없거나 두 이름이 비슷하면 `pickFromList`가 `null`을 주고, 그때는 평소대로
   * 첫 번째가 선택돼 있다. 비어 있는 칸은 사용자가 채우면 되지만 잘못 채워진 칸은
   * 사용자가 알아채야만 고쳐진다.
   */
  const heardPayee = useMemo(
    () => (spoken ? pickFromList(spoken, payees.map((p) => p.name)) : null),
    [spoken, payees],
  );

  /*
   * **금액은 미리 채우지 않는다.** §9.3이 "금액 확정"을 음성으로 불가한 쪽에 뒀고,
   * §7.4의 시퀀스도 "수취인 프리필, 금액 미입력"이라고 못박았다.
   *
   * <p>그렇다고 들은 것을 버리지도 않는다 — 버리면 사용자가 방금 말한 금액을 다시
   * 타이핑해야 하고, 그러면 M9가 없애려던 수고가 그대로 남는다. 대신 <b>제안</b>으로
   * 두어 한 번의 탭을 요구한다. "삼만원"이 "삼십만원"으로 잘못 들렸을 때, 채워진 칸은
   * 사용자가 알아채야 고쳐지지만 <b>제안은 누르지 않으면 아무 일도 일어나지 않는다.</b>
   */
  const heardAmount = useMemo(() => (spoken ? parseAmount(spoken) : null), [spoken]);

  const [payeeId, setPayeeId] = useState(
    () => payees.find((p) => p.name === heardPayee)?.id ?? payees[0]?.id ?? "",
  );
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
          toAccountId: payee.id,
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
      {heardPayee && (
        <p className="field-note" role="status">
          말씀하신 <strong>{heardPayee}</strong>님을 골라 뒀어요. 맞는지 봐 주세요.
        </p>
      )}
      <select
        id={payeeFieldId}
        className="field"
        value={payeeId}
        onChange={(event) => setPayeeId(event.target.value)}
      >
        {payees.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.number})
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

      {/*
        들은 금액은 채우지 않고 제안한다 (§9.3). 누르지 않으면 아무 일도 일어나지 않으므로,
        잘못 들었어도 사용자가 알아채지 못해서 생기는 손해가 없다.
      */}
      {heardAmount !== null && amount === "" && (
        <button
          type="button"
          className="suggestion"
          onClick={() => setAmount(String(heardAmount))}
        >
          {formatWon(heardAmount)}이라고 들었어요 — 눌러서 넣기
        </button>
      )}

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
