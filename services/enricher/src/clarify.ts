import type { LlmClient } from "./llm.js";

/**
 * 못 알아들었을 때 **한 문장으로 되묻는다** (AI-3).
 *
 * <p>지금도 되묻기는 있다 — `buildReprompt`가 후보들의 갈래를 세어 선택지를 만든다.
 * 그것은 결정론이고 빠르지만 <b>질문 문장이 없다.</b> 화면에 갈래 이름 세 개가 나열될
 * 뿐이라, 사용자는 자기가 무엇을 잘못 말했는지 모른 채 다시 고른다.
 *
 * <p>여기서 모델이 하는 일은 <b>질문 한 줄을 쓰는 것</b>과 <b>이미 있는 갈래 중 둘을
 * 고르는 것</b>뿐이다. 갈래를 만들지 못한다 — 번호로 고르게 한 것이 `assist.ts`와 같은
 * 이유다. 없는 갈래를 지어낼 여지가 구조적으로 없다.
 *
 * <p><b>왜 셋이 아니라 둘인가.</b> 되묻기의 기본은 세 갈래(`reprompt.choiceCount`)인데
 * 여기서는 둘로 좁힌다. 모델이 질문 문장을 붙이는 순간 화면은 "고르세요"가 아니라
 * "예/아니오"에 가까워지고, 그때 선택지가 셋이면 질문과 답의 수가 안 맞아 읽기 어려워진다.
 * 셋이 필요하면 모델 없는 되묻기가 이미 그것을 한다.
 */

/** 모델이 쓴 질문의 상한. 한 줄을 넘으면 그것은 되묻기가 아니라 설명이다. */
export const MAX_QUESTION_CHARS = 50;

export interface ClarifyBranch {
  /** 갈래 이름. 카탈로그의 `path`에서 온다 — 모델이 만든 것이 아니다. */
  label: string;
}

export interface Clarification {
  question: string;
  /** 고른 갈래 둘. 순서가 화면 순서다. */
  branches: ClarifyBranch[];
}

export const CLARIFY_SYSTEM = `사용자가 금융 앱에서 원하는 것을 말했는데 어느 것인지 좁혀지지 않았습니다.
고령 사용자에게 **한 번만** 되묻는 질문을 만드세요.

- 질문은 **25자 안팎 한 문장**입니다. 두 문장으로 나누지 마세요
- 아래 갈래 목록에서 **서로 다른 번호 두 개**를 고르세요. 갈래를 새로 만들지 마세요
- 사용자의 말과 가장 관련 있는 둘을 고르세요
- 숫자를 쓰지 마세요. 금액·계좌·날짜를 되묻지 않습니다
- 고를 만한 것이 없으면 pick을 빈 배열로 두세요

좋음: "돈을 보내려는 건가요, 나간 내역을 보려는 건가요?"
나쁨: "무엇을 도와드릴까요?" (되묻는 것이 없음)
나쁨: "얼마를 보내시겠어요?" (금액을 묻고 있음)`;

export const CLARIFY_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string" },
    pick: { type: "array", items: { type: "integer" } },
  },
  required: ["question", "pick"],
} as const;

export function buildClarifyPrompt(
  query: string,
  branches: readonly ClarifyBranch[],
): string {
  const lines = branches.map((branch, index) => `${index}. ${branch.label}`);
  return `사용자가 한 말: "${query}"\n\n갈래:\n${lines.join("\n")}`;
}

/**
 * 모델 답을 되묻기로. **하나라도 어긋나면 통째로 버린다.**
 *
 * <p>`assist`가 범위 밖 번호를 "없는 것"으로 보는 것과 같다. 반쯤 맞는 되묻기를 고쳐서
 * 쓰면 화면에 뜬 두 갈래가 질문과 안 맞을 수 있고, 그러면 되묻기가 사용자를 더 헷갈리게
 * 만든다 — 없느니만 못하다.
 */
export function parseClarifyResponse(
  raw: unknown,
  branches: readonly ClarifyBranch[],
): Clarification | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const question = typeof value["question"] === "string" ? value["question"].trim() : "";
  if (question.length === 0 || question.length > MAX_QUESTION_CHARS) return null;
  /*
   * 숫자를 통째로 막는다 — `validateProposal`이 `why`에 하는 것과 같은 검사다.
   * 금액·계좌번호가 되묻는 문장으로 새어 나오는 것을 막는 가장 단순하고 확실한 방법이고,
   * 잃는 것이 거의 없다. 되묻기는 <b>어느 쪽인지</b>를 묻는 자리이지 값을 묻는 자리가 아니다.
   */
  if (/[0-9０-９]/u.test(question)) return null;

  const pick = value["pick"];
  if (!Array.isArray(pick) || pick.length !== 2) return null;

  const chosen: ClarifyBranch[] = [];
  const seen = new Set<number>();
  for (const index of pick) {
    if (typeof index !== "number" || !Number.isInteger(index)) return null;
    if (seen.has(index)) return null;
    const branch = branches[index];
    if (!branch) return null;
    seen.add(index);
    chosen.push(branch);
  }

  return { question, branches: chosen };
}

/** 한 번의 되묻기. 호출자는 로컬 되묻기를 이미 갖고 있고, 이것은 그 위에 얹힌다. */
export async function clarify(
  llm: LlmClient,
  query: string,
  branches: readonly ClarifyBranch[],
): Promise<Clarification | null> {
  // 갈래가 둘도 안 되면 물어볼 것이 없다. 모델을 부르지 않는다.
  if (branches.length < 2) return null;
  const raw = await llm.json(
    CLARIFY_SYSTEM,
    buildClarifyPrompt(query, branches),
    CLARIFY_SCHEMA,
  );
  return parseClarifyResponse(raw, branches);
}
