import { makeSource, QUOTE_MAX, QUOTE_MIN, type Source } from "./cite.js";
import type { Gemini } from "./gemini.js";
import { ASKED_HINT_MAX, cleanHint } from "./hint.js";
import type { ExplainTarget } from "./explain.js";

/**
 * 문서를 손에 쥐고 푸는 뜻풀이. **답과 함께 근거를 댄다.**
 *
 * <p>`explain.ts`는 메뉴 <b>이름만</b> 보고 푼다. 이름 안에 답이 있는 말(`예수금`)은 그것으로
 * 되지만, 이름 밖에 답이 있는 말은 안 된다 — "중도해지하면 이자가 어떻게 되는지"는
 * `정기예금 해지`라는 이름 어디에도 없고 <b>상품설명서에만</b> 있다. 그것을 읽고 답하는 것이
 * 여기다.
 *
 * <p>문서를 붙이면 답이 좋아지는 대신 새 위험이 생긴다. 사용자는 출처가 붙은 문장을
 * 더 믿는데, 모델은 문서에 없는 문장도 문서의 문장처럼 쓸 수 있다. 그래서 여기서
 * 나가는 근거는 전부 `cite.ts`의 대조를 지난다 — <b>못 지나면 답 전체를 버린다.</b>
 *
 * <p>인용만 버리고 설명은 살리지 않는 이유. 문서를 읽고 답하라고 시켰는데 인용을 못
 * 대면, 그 설명이 문서에서 왔다는 근거도 같이 없다. 그때 남은 설명은 <b>이름만 보고 푼
 * 것보다 나을 이유가 없으면서 문서를 읽은 답처럼 보인다.</b> 그래서 통째로 버리고
 * 호출자가 이름만 보는 길로 되돌아가게 둔다.
 */

/** 답과 근거. `source`가 `null`인 값은 이 모듈에서 나가지 않는다. */
export interface GroundedHint {
  hint: string;
  source: Source;
}

/** 근거로 삼을 문서 하나. */
export interface SourceDocument {
  url: string;
  title: string;
  text: string;
}

/**
 * 모델에게 보여 줄 본문의 상한.
 *
 * <p>상품설명서는 2만 자를 넘는 것이 있고 전부 넣으면 요청이 무거워진다. 자르되,
 * <b>대조도 자른 것에 대고 한다</b> — 보여 준 것과 검사하는 것이 다르면 검사는 뜻이 없다.
 */
export const EXCERPT_MAX = 12_000;

export const GROUNDED_SYSTEM = `한국 금융 앱의 메뉴 이름 하나를, **주어진 안내문에 적힌 내용으로만** 설명합니다.

두 가지를 냅니다.
- hint: 고령 사용자에게 하는 한 줄 설명. 초등학생도 알아들을 생활어.
  **${ASKED_HINT_MAX}자를 넘으면 버려집니다.** 뜻을 깎지 말고 짧게 쓰세요
- quote: 그 설명의 근거가 되는 **안내문 원문 한 문장**

quote 규칙 — 이것을 어기면 답 전체가 버려집니다:
- 안내문에 **있는 그대로** 옮기세요. 한 글자도 고치거나 다듬지 마세요
- 요약하거나 두 문장을 이어 붙이지 마세요
- ${QUOTE_MIN}자 이상 ${QUOTE_MAX}자 이하의 한 조각이어야 합니다
- 근거가 될 문장이 안내문에 없으면 quote를 빈 문자열로 두세요. 지어내지 마세요

절대 하지 않는 것:
- 상품을 **추천**하거나 무엇이 유리한지 말하지 않습니다
- **투자 판단**을 대신하지 않습니다 (사라/팔아라/오른다/내린다)
- 안내문에 없는 금액·수익률·조건을 만들어 넣지 않습니다
- 메뉴 이름을 그대로 되풀이하지 않습니다`;

export const GROUNDED_SCHEMA = {
  type: "object",
  properties: { hint: { type: "string" }, quote: { type: "string" } },
  required: ["hint", "quote"],
} as const;

export function buildGroundedPrompt(target: ExplainTarget, excerpt: string): string {
  const where =
    target.path && target.path.length > 0 ? `\n어디에 있는지: ${target.path.join(" > ")}` : "";
  return `메뉴 이름: ${target.label}${where}

--- 안내문 ---
${excerpt}
--- 안내문 끝 ---`;
}

/**
 * 본문에서 메뉴와 상관있는 대목을 앞으로 당겨 자른다.
 *
 * <p>그냥 앞에서 자르면 상품설명서의 첫 1만 자는 대개 <b>표지와 자격 요건</b>이라,
 * 정작 사용자가 묻는 대목(해지·수수료·이자)이 잘려 나간다. 이름에 든 낱말이 처음
 * 나오는 자리를 중심으로 잡되, 그 앞도 조금 남긴다 — 문장이 중간에서 시작하면 인용이
 * 문장이 아니게 된다.
 */
export function excerptFor(target: ExplainTarget, text: string): string {
  if (text.length <= EXCERPT_MAX) return text;

  const keywords = [target.label, ...(target.path ?? [])]
    .flatMap((part) => part.split(/[\s/·()]+/))
    .filter((word) => word.length >= 2);

  let at = -1;
  for (const word of keywords) {
    const found = text.indexOf(word);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return text.slice(0, EXCERPT_MAX);

  const from = Math.max(0, at - 1_000);
  return text.slice(from, from + EXCERPT_MAX);
}

/**
 * 모델 답을 근거 있는 뜻풀이로. **설명과 인용 중 하나라도 안 되면 `null`.**
 */
export function parseGroundedResponse(
  raw: unknown,
  target: ExplainTarget,
  document: SourceDocument,
): GroundedHint | null {
  if (typeof raw !== "object" || raw === null) return null;

  const hint = cleanHint((raw as Record<string, unknown>)["hint"], target.label, ASKED_HINT_MAX);
  if (hint.length === 0) return null;

  const source = makeSource((raw as Record<string, unknown>)["quote"], document);
  if (source === null) return null;

  return { hint, source };
}

/**
 * 길이 때문에 걸렸는가.
 *
 * <p>이것만 다시 묻는 이유가 있다. 인용을 못 댄 답은 다시 물어도 문서에 근거가 없는
 * 것이고, 이름을 되풀이한 답은 다시 물어도 같은 이름이다. 하지만 <b>길이는 답의
 * 내용과 상관이 없다</b> — 재 보니 버려진 여섯 중 다섯이 이것이었고, 그 다섯은 인용까지
 * 통과한 멀쩡한 답이었다.
 */
function tooLongOnly(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const hint = (raw as Record<string, unknown>)["hint"];
  return typeof hint === "string" && hint.replace(/\s+/g, " ").trim().length > ASKED_HINT_MAX;
}

const SHORTEN_NOTE = `

이전 답이 너무 길어 버려졌습니다. **${ASKED_HINT_MAX}자 이내**로 다시 쓰세요.
설명에서 덜 중요한 부분을 덜어 내되, 뜻이 깎이면 안 됩니다. quote는 그대로 두세요.`;

/**
 * 문서 하나를 읽고 푼다. 호출자는 실패를 이름만 보는 길로 받아야 한다.
 *
 * <p>길이로 걸리면 <b>한 번만</b> 더 묻는다. 상한을 늘리지 않은 것은 이 답이 전체 메뉴
 * 목록 안에 인용 한 줄과 함께 놓이기 때문이다 — 거기서 설명이 길어지면 읽을 것을
 * 줄이려던 기능이 읽을 것을 늘린다.
 */
export async function explainWithSource(
  gemini: Gemini,
  target: ExplainTarget,
  document: SourceDocument,
): Promise<GroundedHint | null> {
  const excerpt = excerptFor(target, document.text);
  // 대조는 **보여 준 것**에 대고 한다.
  const shown = { ...document, text: excerpt };
  const prompt = buildGroundedPrompt(target, excerpt);

  const raw = await gemini.json(GROUNDED_SYSTEM, prompt, GROUNDED_SCHEMA);
  const parsed = parseGroundedResponse(raw, target, shown);
  if (parsed !== null || !tooLongOnly(raw)) return parsed;

  const retried = await gemini.json(GROUNDED_SYSTEM + SHORTEN_NOTE, prompt, GROUNDED_SCHEMA);
  return parseGroundedResponse(retried, target, shown);
}
