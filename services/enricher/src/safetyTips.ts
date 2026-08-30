import type { LlmClient } from "./llm.js";

/**
 * 안심 점검마다 **무엇을 확인하면 되는지** 한 줄 (AI-5).
 *
 * <p>`safety.ts`가 내는 문장은 <b>무엇이 걸렸는지</b>를 말한다 — "이 분께는 처음
 * 보내시네요". 그것을 읽은 사용자에게 남는 물음은 <b>"그래서 뭘 어떻게 하라고?"</b>이고,
 * 화면이 거기서 멈추면 경고는 불안만 남기고 끝난다.
 *
 * <p>그래서 모델이 쓰는 것은 <b>할 일</b>이지 <b>주장</b>이 아니다.
 *
 * <pre>
 *   좋음  "받는 분께 전화해 계좌번호를 직접 확인해 보세요."
 *   나쁨  "보이스피싱은 대개 처음 보내는 계좌로 갑니다."   ← 근거 없는 주장
 * </pre>
 *
 * <p>뒤엣것을 막는 것이 이 파일의 요점이다. 이 저장소는 뜻풀이에 원문 인용을 붙이려고
 * 애썼고(§15), 같은 화면에서 출처 없는 통계를 말하면 그 노력이 무의미해진다. 프롬프트로
 * 금지하고, 돌아온 것은 길이·숫자 검사를 지난다.
 *
 * <p><b>여섯 가지뿐이라 캐시가 거의 공짜다.</b> `SafetyKind`는 닫힌 집합이고 값이
 * 실리지 않으므로, 종류 이름만으로 답이 정해진다 — 한 번 물으면 그 뒤로는 한도를 안 쓴다.
 */

/** 안심 점검의 종류. `packages/core/src/safety.ts`의 `SafetyKind`와 **같아야 한다.** */
export const SAFETY_KINDS = [
  "same-name-payee",
  "sent-again-soon",
  "larger-than-usual",
  "first-time-payee",
  "drains-balance",
  "late-night",
] as const;

export type SafetyKindName = (typeof SAFETY_KINDS)[number];

/** 한 줄 상한. 길어지면 확인 화면이 읽을 것 투성이가 되어 아무도 안 읽는다. */
export const MAX_TIP_CHARS = 45;

export interface SafetyTip {
  kind: SafetyKindName;
  text: string;
}

export const SAFETY_SYSTEM = `고령 사용자가 돈을 보내기 직전입니다. 화면이 걸러 낸 확인 항목마다
**지금 무엇을 하면 되는지** 한 줄로 알려 주세요.

- 각 항목에 **20자 안팎 한 문장**. 길면 아무도 안 읽습니다
- **할 일**을 쓰세요. 통계나 위험 주장을 쓰지 마세요
- 숫자를 절대 쓰지 마세요. 금액·계좌번호·기간은 여러분이 쓰는 것이 아닙니다
- 겁을 주지 마세요. 판단은 사용자가 합니다
- 존댓말, 쉬운 생활어

항목의 뜻:
  same-name-payee    받는 분 목록에 같은 이름이 둘 이상 있다
  sent-again-soon    조금 전에 같은 분께 같은 금액을 보냈다
  larger-than-usual  평소 이 분께 보내던 것보다 큰 금액이다
  first-time-payee   이 기기 기록에 없는 분께 처음 보낸다
  drains-balance     보내고 나면 남는 돈이 얼마 없다
  late-night         지금이 늦은 밤이다

좋음: first-time-payee → "받는 분께 전화해 계좌번호를 확인해 보세요."
좋음: late-night → "급하지 않다면 내일 아침에 하셔도 됩니다."
나쁨: first-time-payee → "사기 계좌일 수 있습니다." (근거 없는 주장)
나쁨: drains-balance → "잔액이 3만원 남습니다." (숫자를 직접 씀)`;

export const SAFETY_SCHEMA = {
  type: "object",
  properties: {
    tips: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string" }, text: { type: "string" } },
        required: ["kind", "text"],
      },
    },
  },
  required: ["tips"],
} as const;

/** **종류 이름만 보낸다.** 금액도 수취인도 잔액도 이 본문에 담을 자리가 없다. */
export function buildSafetyPrompt(kinds: readonly string[]): string {
  return `확인 항목:\n${kinds.map((kind) => `- ${kind}`).join("\n")}`;
}

/**
 * 모델 답을 한 줄들로. **항목 하나가 나빠도 나머지는 살린다.**
 *
 * <p>`validateProposals`가 여럿을 받을 때 하는 것과 같다 — 하나가 숫자를 썼다고 여섯을
 * 다 버리면, 쓸 수 있었던 다섯 줄이 함께 사라진다. 대신 <b>버린 것은 화면에 없다</b>:
 * 그 항목은 지금까지처럼 기본 문장만 보인다.
 */
export function parseSafetyResponse(
  raw: unknown,
  asked: readonly string[],
): SafetyTip[] {
  if (typeof raw !== "object" || raw === null) return [];
  const tips = (raw as Record<string, unknown>)["tips"];
  if (!Array.isArray(tips)) return [];

  const wanted = new Set(asked);
  const seen = new Set<string>();
  const kept: SafetyTip[] = [];

  for (const item of tips) {
    if (typeof item !== "object" || item === null) continue;
    const value = item as Record<string, unknown>;

    const kind = value["kind"];
    // 묻지 않은 항목에 답하면 버린다. 모델이 항목을 만들어 낼 수는 없다.
    if (typeof kind !== "string" || !wanted.has(kind) || seen.has(kind)) continue;
    if (!(SAFETY_KINDS as readonly string[]).includes(kind)) continue;

    const text = typeof value["text"] === "string" ? value["text"].trim() : "";
    if (text.length === 0 || text.length > MAX_TIP_CHARS) continue;
    // 숫자를 통째로 막는다 — `validateProposal`이 `why`에 하는 것과 같은 검사다.
    if (/[0-9０-９]/u.test(text)) continue;

    seen.add(kind);
    kept.push({ kind: kind as SafetyKindName, text });
  }

  return kept;
}

export async function safetyTips(
  llm: LlmClient,
  kinds: readonly string[],
): Promise<SafetyTip[]> {
  const asked = kinds.filter((kind) => (SAFETY_KINDS as readonly string[]).includes(kind));
  if (asked.length === 0) return [];
  const raw = await llm.json(SAFETY_SYSTEM, buildSafetyPrompt(asked), SAFETY_SCHEMA);
  return parseSafetyResponse(raw, asked);
}
