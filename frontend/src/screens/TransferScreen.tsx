import {
  DEFAULT_CONFIG,
  checkTransfer,
  parseAmount,
  pickFromList,
  requiresExtraConfirm,
} from "@minui/core";
import { makeConfirmSentence, type ConfirmSentence } from "@host-ai/confirm.js";
import { makeSafetyTips, type SafetyTips } from "@host-ai/safetyTips.js";
import { ProvenanceBadge, SafetyNotes, SpeakButton } from "@minui/react";
import { useEffect, useId, useMemo, useState } from "react";
import { useBank } from "../BankContext.js";
import { buildTransferFacts } from "../safetyFacts.js";
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
  const { accounts, selectedAccount, payees, transactions, complete, api, reload } = useBank();
  const isOpenBankingMock = api.demoMode === "open-banking-mock";
  /**
   * **한 화면 한 가지** (F18). M16의 도움 정도가 지금까지는 밀도만 바꿨는데, 이체는
   * 이 앱에서 <b>한 화면이 가장 많은 것을 요구하는 자리</b>다 — 받는 분과 금액을 함께
   * 물어보고 그 아래에 통장·고지·제안이 같이 있다.
   *
   * <p>공개 데모는 한 가지 일반 화면으로 고정한다. 같은 상태·같은 API·같은 확인 단계를
   * 쓰므로, 이체 순서와 마지막 확인은 화면 도움 설정에 따라 바뀌지 않는다.
   */
  const stepwise = false;
  const [step, setStep] = useState<"payee" | "amount">("payee");

  /**
   * 확인 문장을 모델이 쓴다 (AI-4). **중계기가 없으면 `undefined`다** — 그러면 아래
   * 효과가 아무것도 안 하고, 화면은 지금까지의 고정 문구를 그대로 쓴다.
   *
   * <p>`useMemo`로 한 번만 만든다. 매 렌더 새로 만들면 아래 효과의 의존성이 매번
   * 달라져 확인 화면에 들어갈 때마다 모델을 다시 부른다.
   */
  const askConfirm = useMemo(() => makeConfirmSentence(), []);
  const [aiConfirm, setAiConfirm] = useState<ConfirmSentence | null>(null);

  /**
   * 점검마다 **지금 무엇을 하면 되는지** 한 줄 (AI-5).
   *
   * <p>확인 문장과 따로 묻는 이유는 캐시 때문이다. 확인 문장은 위험도와 점검 조합으로
   * 캐시되지만, 조언은 <b>점검 종류 이름만</b>으로 정해진다 — `SafetyKind`가 여섯이라
   * 조합이 유한하고, 며칠이면 사실상 전부 캐시돼 한도를 안 쓴다.
   */
  const askTips = useMemo(() => makeSafetyTips(), []);
  const [aiTips, setAiTips] = useState<SafetyTips | null>(null);

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

  /*
   * **못 고르면 비워 둔다.** 맨 앞 수취인으로 채우지 않는다.
   *
   * `pickFromList`는 애매하면 일부러 `null`을 주고, 그 doc이 이유를 못박아 뒀다 —
   * "비어 있는 칸은 사용자가 채우면 되지만, 잘못 채워진 칸은 사용자가 알아채야만
   * 고쳐진다." 여기서 `payees[0]`으로 기본값을 채우면 그 거절이 화면에서 사라진다.
   *
   * 리허설에서 실제로 그랬다. "삼촌한테 3만원 보내줘"라고 했더니 엔진은 아무도 안
   * 골랐는데 화면에는 `행복아파트 관리사무소`가 골라져 있었다. 고령 사용자와 큰
   * `보내기` 버튼이 함께 있는 화면에서 그것은 이 기능이 할 수 있는 가장 나쁜 실수다.
   */
  const [payeeId, setPayeeId] = useState(
    () => payees.find((p) => p.name === heardPayee)?.id ?? "",
  );
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ payee: string; amount: number } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    fromAccountId: string;
    payeeId: string;
    payeeName: string;
    payeeNumber: string;
    amount: number;
  } | null>(null);
  /** 고위험 이체는 최종 버튼과 별도로 수취 정보 확인을 명시적으로 받는다. */
  const [recipientChecked, setRecipientChecked] = useState(false);
  const [sending, setSending] = useState(false);

  const payeeFieldId = useId();
  const amountFieldId = useId();
  const sourceFieldId = useId();

  /*
   * 어느 통장에서 나가는가.
   *
   * <p>전에는 `accounts[0]`이었다 — 사용자가 한 사람이고 통장이 둘이던 때는 물을
   * 필요가 없었기 때문이다. 사람마다 통장 수가 다른 지금, 안 묻는 것은 <b>틀린 통장에서
   * 돈이 나가는 것</b>이 된다. 다만 통장이 하나뿐인 사람에게는 아래에서 칸 자체를
   * 안 그린다 — 모두에게 한 걸음을 물리면 이 저장소가 줄이려는 단계 수가 늘어난다.
   */
  const [sourceId, setSourceId] = useState(() => selectedAccount?.id ?? "");
  const account = accounts.find((item) => item.id === sourceId) ?? selectedAccount ?? accounts[0];
  const payee = payees.find((p) => p.id === payeeId);

  function prepareConfirmation() {
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

    setConfirmation({
      fromAccountId: account.id,
      payeeId: payee.id,
      payeeName: payee.name,
      payeeNumber: payee.number,
      amount: value,
    });
    setRecipientChecked(false);
  }

  async function send(confirmed: NonNullable<typeof confirmation>) {
    setError(null);
    const source = accounts.find((entry) => entry.id === confirmed.fromAccountId);
    const destination = payees.find((entry) => entry.id === confirmed.payeeId);

    if (
      !source ||
      !destination ||
      destination.name !== confirmed.payeeName ||
      destination.number !== confirmed.payeeNumber
    ) {
      setConfirmation(null);
      setRecipientChecked(false);
      setError("보낼 계좌 또는 받는 분이 바뀌었습니다. 다시 확인해 주세요.");
      return;
    }

    setSending(true);
    try {
      // 멱등성 키. M1 백엔드에서 중복 이체를 막는 데 쓰인다.
      const result = await api.transfer(
        {
          fromAccountId: source.id,
          toAccountId: destination.id,
          amount: confirmed.amount,
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

  /*
   * 확인 화면에 들어갈 때 한 번 묻는다. **보내는 것에 값이 없다** — 위험도와 걸린
   * 점검의 종류 이름뿐이고, 수취인·금액은 답이 온 뒤 이쪽에서 채운다 (`confirm.ts`).
   *
   * 훅이라 **조기 반환보다 위**에 둔다. `if (done)` 아래에 두면 이체가 끝난 렌더에서
   * 훅 수가 줄어 React가 트리를 통째로 버린다 — 실제로 그렇게 만들었다가 잡았다.
   */
  useEffect(() => {
    if (!confirmation || (!askConfirm && !askTips)) {
      setAiConfirm(null);
      setAiTips(null);
      return;
    }

    let cancelled = false;
    const facts = buildTransferFacts({
      payee: {
        id: confirmation.payeeId,
        name: confirmation.payeeName,
        number: confirmation.payeeNumber,
        lastSentAt: "",
      },
      amount: confirmation.amount,
      balance: account?.balance ?? 0,
      transactions,
      payees,
    });

    const kinds = checkTransfer(facts, DEFAULT_CONFIG).map((note) => note.kind);

    void askConfirm?.(
      { riskLevel: "high", concerns: kinds },
      { payee: confirmation.payeeName, amount: formatWon(confirmation.amount) },
    )?.then((sentence) => {
      if (!cancelled) setAiConfirm(sentence);
    });

    // 걸린 것이 없으면 묻지 않는다. 조언할 대상이 없는데 한도를 쓸 이유가 없다.
    if (askTips && kinds.length > 0) {
      void askTips(kinds).then((tips) => {
        if (!cancelled) setAiTips(tips);
      });
    }

    return () => {
      cancelled = true;
    };
    // 확인 대상이 바뀔 때만 다시 묻는다. 잔액·목록이 갱신됐다고 다시 부르지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askConfirm, askTips, confirmation]);

  if (done) {
    return (
      <ScreenFrame title="이체 완료" onBack={onBack}>
        <p className="notice" role="status">
          {done.payee}님께 {formatWon(done.amount)}을 보냈습니다.
        </p>
        {isOpenBankingMock && (
          <p className="mock-api-note">
            가상 오픈뱅킹 Mock이 성공 응답을 보냈고, 테스트 원장이 바뀌었습니다.
          </p>
        )}
        <WrongTransferHelp />
        <button type="button" className="primary-button" onClick={onBack}>
          확인
        </button>
      </ScreenFrame>
    );
  }

  if (confirmation) {
    /*
     * **안심 점검** (F13). 전에는 「같은 이름의 받는 분」 하나였고 그 판정이 이 파일 안에
     * 있었다. 여섯으로 넓히면서 규칙을 엔진으로 옮겼다 — 다른 금융 앱도 같은 문을
     * 쓰려면 규칙이 화면 안에 있으면 안 된다 (`packages/core/src/safety.ts`).
     *
     * 점검은 이체를 <b>막지 않는다.</b> `stop`이 하나라도 있으면 확인 표시를 하나 더
     * 받을 뿐이고, 그 표시가 없어도 기존 확인 단계는 그대로 있다.
     */
    const notes = checkTransfer(
      buildTransferFacts({
        payee: {
          id: confirmation.payeeId,
          name: confirmation.payeeName,
          number: confirmation.payeeNumber,
          lastSentAt: "",
        },
        amount: confirmation.amount,
        balance: account?.balance ?? 0,
        transactions,
        payees,
      }),
      DEFAULT_CONFIG,
    );
    const needsSafetyCheck = requiresExtraConfirm(notes);

    /*
     * **읽어 줄 문장을 여기서 만든다** (F16). 화면의 `<dt>`/`<dd>`를 긁어모으지 않는
     * 이유는 `SpeakButton`의 doc에 적어 뒀다 — 구조가 바뀌면 읽는 말이 조용히 달라진다.
     *
     * 계좌번호를 문장에 그대로 넣는다. 가리는 일은 구현체가 하고(`maskDigits`),
     * 화면은 <b>보이는 것과 같은 문장</b>을 넘기는 데만 책임진다. 두 곳에서 가리면
     * 규칙이 둘이 되고, 둘이 되는 순간 어긋난다.
     */
    const spokenSummary = [
      `${account?.nickname ?? "선택한 통장"}에서`,
      `${confirmation.payeeName}님, 계좌번호 ${confirmation.payeeNumber}로`,
      `${formatWon(confirmation.amount)}을 보냅니다.`,
      "맞으면 확인 표시를 하고 보내기를 눌러 주세요.",
    ].join(" ");

    return (
      <ScreenFrame
        title="보낼 내용 확인"
        onBack={() => {
          setConfirmation(null);
          setRecipientChecked(false);
        }}
        menuId="transfer.account"
        guide="받는 분, 계좌번호, 금액을 확인하고 표시해 주세요."
      >
        <div className="confirm-head">
          {/*
            모델이 쓴 문장이 있으면 그것을 쓰고, 없으면 지금까지의 고정 문구를 쓴다.
            **없는 것이 고장으로 보이지 않는다** — 두 문장 다 같은 일을 말한다.

            출처 배지를 붙이는 이유: 이 자리는 돈이 나가기 직전이라, 화면의 말이
            누구 말인지 사용자가 알 수 있어야 한다.
          */}
          <p className="field-note">
            {aiConfirm ? (
              <>
                <ProvenanceBadge provenance="ai" model={aiConfirm.model} />
                {aiConfirm.text}
              </>
            ) : (
              "아직 보내지 않았어요. 아래 내용을 확인해 주세요."
            )}
          </p>
          <SpeakButton
            text={aiConfirm ? `${aiConfirm.text} ${spokenSummary}` : spokenSummary}
            label="보낼 내용을 소리로 들려주기"
          />
        </div>
        <dl className="transfer-confirmation">
          <div>
            <dt>보낼 통장</dt>
            <dd>{account?.nickname ?? "선택한 통장"}</dd>
          </div>
          <div>
            <dt>받는 분</dt>
            <dd>{confirmation.payeeName}</dd>
          </div>
          <div>
            <dt>받는 계좌번호</dt>
            <dd>{confirmation.payeeNumber}</dd>
          </div>
          <div>
            <dt>보낼 금액</dt>
            <dd>{formatWon(confirmation.amount)}</dd>
          </div>
        </dl>
        <SafetyNotes
          notes={notes}
          formatAmount={formatWon}
          {...(aiTips
            ? {
                tips: Object.fromEntries(aiTips.tips.map((tip) => [tip.kind, tip.text])),
                tipModel: aiTips.model,
              }
            : {})}
        />
        <label className="recipient-check">
          <input
            type="checkbox"
            checked={recipientChecked}
            onChange={(event) => setRecipientChecked(event.target.checked)}
          />
          <span>
            {needsSafetyCheck
              ? "받는 분과 계좌번호가 맞습니다."
              : "받는 분과 계좌번호를 확인했습니다."}
          </span>
        </label>
        {!recipientChecked && (
          <p className="field-note" role="status">
            확인 표시를 해야 보낼 수 있어요.
          </p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setConfirmation(null);
            setRecipientChecked(false);
          }}
          disabled={sending}
        >
          돌아가서 고치기
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => void send(confirmation)}
          disabled={sending || !recipientChecked}
        >
          {sending ? "보내는 중" : "네, 확인하고 보내기"}
        </button>
      </ScreenFrame>
    );
  }

  /*
   * 두 갈래가 **같은 조각**을 쓴다. 조각을 복사해 두면 한쪽만 고쳐지는 날이 오고,
   * 그날 두 도움 정도의 화면이 서로 다른 것을 묻게 된다.
   */
  const payeeField = (
    <>
      <label className="field-label" htmlFor={payeeFieldId}>
        받는 분
      </label>
      {heardPayee && (
        <p className="field-note" role="status">
          <strong>{heardPayee}</strong>님으로 골랐어요. 맞는지 확인해 주세요.
        </p>
      )}
      <select
        id={payeeFieldId}
        className="field"
        value={payeeId}
        onChange={(event) => setPayeeId(event.target.value)}
      >
        {/*
          비어 있는 상태에 이름을 준다. 빈 칸이 고장으로 읽히지 않게, 그리고
          무엇을 해야 하는지가 칸 안에서 보이게.
        */}
        <option value="">받는 분을 고르세요</option>
        {payees.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.number})
          </option>
        ))}
      </select>
    </>
  );

  const amountField = (
    <>
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
    </>
  );

  const errorLine = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  const accountLine =
    accounts.length > 1 ? (
      <>
        <label className="field-label" htmlFor={sourceFieldId}>
          보낼 통장
        </label>
        <select
          id={sourceFieldId}
          className="field"
          value={account?.id ?? ""}
          onChange={(event) => setSourceId(event.target.value)}
        >
          {accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nickname} ({formatWon(item.balance)})
            </option>
          ))}
        </select>
      </>
    ) : (
      <p className="field-note">
        보낼 통장: {account?.nickname} ({formatWon(account?.balance ?? 0)})
      </p>
    );

  const mockNote = isOpenBankingMock && (
    <p className="mock-api-note">
      시연용 가상 Open Banking 요청입니다. 실제 계좌·토큰은 쓰지 않습니다.
    </p>
  );

  /*
   * **단순형 — 한 번에 하나만 묻는다** (F18).
   *
   * 통장 줄과 Mock 고지를 첫 걸음에만 둔다. 두 걸음 모두에 붙이면 "한 가지만"이라는
   * 약속이 첫 줄부터 깨진다. 걸음 표시("1 / 2 단계")를 두는 것은 <b>끝이 보여야
   * 시작한다</b>는 이유다 — 몇 걸음인지 모르는 절차는 그 자체가 벽이다.
   */
  if (stepwise) {
    const onPayeeStep = step === "payee";

    return (
      <ScreenFrame
        title="계좌 이체"
        onBack={onPayeeStep ? onBack : () => setStep("payee")}
        menuId="transfer.account"
        guide={
          onPayeeStep
            ? "누구에게 보낼지 먼저 고르세요."
            : "얼마를 보낼지 적으세요."
        }
      >
        <p className="step-mark">{onPayeeStep ? "1 / 2 단계" : "2 / 2 단계"}</p>
        {onPayeeStep ? (
          <>
            {accountLine}
            {mockNote}
            {payeeField}
            {errorLine}
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (!payee) {
                  setError("받는 분을 선택해 주세요.");
                  return;
                }
                setError(null);
                setStep("amount");
              }}
            >
              다음
            </button>
          </>
        ) : (
          <>
            <p className="field-note">
              받는 분: <strong>{payee?.name}</strong>
            </p>
            {amountField}
            {errorLine}
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStep("payee")}
            >
              받는 분 다시 고르기
            </button>
            <button type="button" className="primary-button" onClick={prepareConfirmation}>
              내용 확인하기
            </button>
          </>
        )}
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      title="계좌 이체"
      onBack={onBack}
      menuId="transfer.account"
      guide="받는 분과 보낼 금액을 적으세요."
    >
      {accountLine}
      {mockNote}
      {payeeField}
      {amountField}
      {errorLine}
      <button
        type="button"
        className="primary-button"
        onClick={prepareConfirmation}
      >
        내용 확인하기
      </button>
    </ScreenFrame>
  );
}

/**
 * 잘못 보냈을 때 무엇을 하는가 (F15).
 *
 * <p>완료 화면은 지금까지 "보냈습니다"와 확인 버튼뿐이었다. 실수를 알아차리는 자리가
 * 바로 여기인데, 여기서 할 수 있는 일이 <b>확인을 누르는 것</b>뿐이면 사용자는 앱을
 * 껐다가 가족에게 전화한다.
 *
 * <p><b>숫자를 적지 않는다.</b> 반환 신청 기한도 수수료도 제도의 값이라 바뀐다.
 * 시연용 화면에 최신성이 필요한 값을 적으면 근거 없는 주장이 되고, 그것은 이 저장소가
 * 뜻풀이에 원문 인용을 붙인 이유와 정반대다 (기획안 §15). 그래서 <b>순서만</b> 적는다.
 *
 * <p>접어 둔 것도 판단이다. 방금 정상적으로 보낸 사람에게 반환 절차를 펼쳐 보이면
 * 방금 한 일이 잘못된 일처럼 읽힌다.
 */
function WrongTransferHelp() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="quiet-link" onClick={() => setOpen(true)}>
        잘못 보내셨나요?
      </button>
    );
  }

  return (
    <section className="wrong-transfer-help" aria-label="잘못 보냈을 때">
      <p className="field-note">순서대로 해 보세요.</p>
      <ol className="wrong-transfer-steps">
        <li>받는 분에게 먼저 연락해 돌려 달라고 부탁합니다.</li>
        <li>연락이 안 되면 보낸 은행 고객센터에 착오송금이라고 알립니다.</li>
        <li>은행에서 돌려받지 못하면 예금보험공사의 착오송금 반환지원 제도를 문의합니다.</li>
      </ol>
      <p className="mock-api-note">
        시연용 일반 안내입니다. 기한과 수수료는 은행과 예금보험공사 안내를 확인해 주세요.
      </p>
      <button type="button" className="quiet-link" onClick={() => setOpen(false)}>
        접기
      </button>
    </section>
  );
}
