import type { SafetyKind, SafetyNote } from "@minui/core";
import { ProvenanceBadge } from "./ProvenanceBadge.js";

/**
 * 보내기 직전 안심 점검을 사람이 읽는 말로 (F13).
 *
 * <p><b>말이 여기 있는 이유.</b> `packages/core/src/safety.ts`는 `{kind, level}`만
 * 돌려준다 — 규칙과 문장을 한 파일에 두면 다른 언어로 옮길 때 둘이 함께 끌려가고,
 * 그러면 규칙만 재사용할 수가 없다. `validateProposal`이 라벨을 카탈로그에서만
 * 가져오는 것과 같은 경계다.
 *
 * <p><b>금액을 문장으로 만드는 일은 호스트가 한다</b> (`formatAmount`). 통화 표기는
 * 호스트의 것이고, 엔진이 "원"을 알아야 할 이유가 없다.
 *
 * <p>겁을 주지 않는다. 이 화면의 목적은 이체를 막는 것이 아니라 <b>읽게 하는 것</b>이다.
 * 그래서 문장은 사실만 말하고 판단은 사용자에게 남긴다 — "사기입니다"가 아니라
 * "이 분께는 처음 보내시네요"다. 앞의 말은 아닐 때 신뢰를 잃고, 뒤의 말은 언제나 참이다.
 */

export interface SafetyNotesProps {
  notes: readonly SafetyNote[];
  /** 호스트의 통화 표기. 없으면 숫자를 쓰지 않는 문장만 나온다. */
  formatAmount?: (amount: number) => string;
  /**
   * 항목마다 **지금 무엇을 하면 되는지** 한 줄 (AI-5). 없으면 걸린 것만 보인다.
   *
   * <p>`kind`를 키로 받는다 — 순서로 맞추면 점검이 하나 빠졌을 때 조언이 한 칸씩
   * 밀려서 엉뚱한 항목에 붙는다.
   */
  tips?: Readonly<Record<string, string>>;
  /** 그 한 줄을 쓴 모델. 배지에 실린다. */
  tipModel?: string | undefined;
}

/** 걸린 것을 한 줄로. `detail`이 없거나 표기 함수가 없으면 숫자 없는 문장이 된다. */
function sentence(
  note: SafetyNote,
  formatAmount: ((amount: number) => string) | undefined,
): string {
  const usual = note.detail?.usualAmount;
  const left = note.detail?.remainingBalance;

  const TEXT: Record<SafetyKind, string> = {
    "same-name-payee":
      "같은 이름의 받는 분이 또 있어요. 계좌번호 전체를 특히 다시 확인해 주세요.",
    "sent-again-soon":
      "조금 전에 같은 분께 같은 금액을 보내셨어요. 두 번 보내려던 것이 맞나요?",
    "larger-than-usual":
      usual !== undefined && formatAmount
        ? `평소에는 이 분께 ${formatAmount(usual)}까지 보내셨어요. 이번은 그보다 큽니다.`
        : "평소보다 큰 금액이에요.",
    "first-time-payee": "이 분께는 처음 보내시네요.",
    "drains-balance":
      left !== undefined && formatAmount
        ? `보내고 나면 ${formatAmount(left)}이 남아요.`
        : "보내고 나면 남는 돈이 얼마 없어요.",
    "late-night": "지금은 늦은 시간이에요. 서두르지 않으셔도 됩니다.",
  };

  return TEXT[note.kind];
}

export function SafetyNotes({ notes, formatAmount, tips, tipModel }: SafetyNotesProps) {
  /*
   * **아무것도 안 걸리면 아무것도 안 그린다.** 빈 상자를 남겨 두면 그 자리가 배경이
   * 되고, 정말 걸렸을 때 늘 있던 것으로 읽힌다.
   */
  if (notes.length === 0) return null;

  /*
   * **`role="alert"`이 아니다.** 처음에는 그렇게 뒀는데 두 가지가 걸렸다.
   *
   * ① 이 목록은 사용자의 동작에 <b>반응해서</b> 뜨는 것이 아니라 확인 화면에 이미
   *    있는 내용이다. alert로 두면 화면에 도착하자마자 여섯 문장이 끼어든다 —
   *    읽어 주는 것이 아니라 막는 것이다.
   * ② 정말 급한 말인 오류 문구(`role="alert"`)와 같은 자리를 다투게 된다. 실제로
   *    "잔액이 부족합니다"를 찾던 테스트가 이것을 먼저 집었다. 화면에 alert가 둘이면
   *    스크린리더 사용자에게도 어느 것이 방금 일어난 일인지 흐려진다.
   *
   * 이름 붙은 구역(region)으로 두면 확인 화면을 훑는 중에 제목과 함께 읽힌다.
   */
  return (
    <section className="minui-safety" aria-labelledby="minui-safety-title">
      <p className="minui-safety-title" id="minui-safety-title">
        보내기 전에 확인해 주세요
      </p>
      <ul className="minui-safety-list">
        {notes.map((note) => {
          const tip = tips?.[note.kind];
          return (
            <li
              key={note.kind}
              className={note.level === "stop" ? "minui-safety-stop" : "minui-safety-notice"}
            >
              {sentence(note, formatAmount)}
              {/*
                할 일은 걸린 것 **아래**에 한 단계 물러나 붙는다 (AI-5). 같은 무게로
                두면 한 항목이 두 줄이 되어 여섯 개가 열두 줄이 되고, 그러면 아무도
                안 읽는다. 무엇이 걸렸는지가 먼저이고 무엇을 할지가 그다음이다.
              */}
              {tip && <span className="minui-safety-tip">{tip}</span>}
            </li>
          );
        })}
      </ul>
      {/*
        조언이 모델의 것이라는 표시는 **목록 아래 한 번만** 붙인다. 줄마다 붙이면
        배지가 조언보다 많아진다.
      */}
      {tips && Object.keys(tips).length > 0 && (
        <ProvenanceBadge provenance="ai" model={tipModel} />
      )}
    </section>
  );
}
