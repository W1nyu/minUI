import { normalize } from "@minui/core";
import { isClean, overlap } from "./eval-contamination.js";

/**
 * 모델에게 질의를 받되, **정답을 보여 주지 않는다** (M11 Task 13, `blind-paraphrase`).
 *
 * <h3>이것이 §0의 흠을 실제로 없애는가</h3>
 * §0: <b>"질의도 내가 쓰고 동의어도 내가 썼다."</b> 문제는 글자가 아니라 <b>저자</b>에
 * 있다. 그래서 기존 질의를 다듬는 것으로는 안 고쳐진다 — 다듬는 사람이 또 정답을 아는
 * 사람이고, 겹치지 않게 피해 쓰면 오염의 방향만 바뀐다.
 *
 * <p>여기서는 <b>정답을 본 적 없는 저자</b>를 세운다. 프롬프트에 들어가는 것은 뜻풀이와
 * 갈래뿐이고, 라벨·동의어·메뉴 id는 <b>한 글자도 안 들어간다</b>(테스트가 고정한다).
 * 받은 뒤에도 같은 오염 필터로 한 번 더 거른다.
 *
 * <h3>남는 흠 — 다른 종류다</h3>
 * <b>모델은 73세처럼 말하지 않는다.</b> 문법이 반듯하고 머뭇거림도 사투리도 없다.
 * 그래서 이 세트로 잴 수 있는 것은 <b>"글자가 안 겹치는 바꿔 쓴 말에서 이겼다"</b>까지다.
 * "고령 사용자가 실제로 하는 말에서 이겼다"는 제3자 질의나 M10 참가자 발화가 있어야 한다.
 *
 * <p>그래서 `source`로 갈라 두고 <b>합계를 내지 않는다.</b> 오염 정도가 다른 것을 한
 * 수치로 합치면 그 수치가 무엇을 말하는지 알 수 없게 된다.
 */

export interface QueryEnvelope {
  menuId: string;
  /** 정답 라벨. **프롬프트에 넣지 않는다.** 거를 때만 쓴다. */
  expect: string;
  /** 정답의 동의어. 위와 같다. */
  synonyms: readonly string[];
  /** 참가자·모델에게 보여 줄 설명. */
  shown: string;
  /** 흘리는 조각을 뺀 갈래. */
  context: readonly string[];
}

export const QUERY_SYSTEM = `당신은 휴대폰 은행·증권 앱을 쓰는 평범한 사람입니다.

앱에 **말로 시키는 기능**이 생겼습니다. 어떤 화면에서 할 수 있는 일을 알려 주면,
그 일을 하려고 할 때 **입 밖으로 나올 말**을 그대로 적으세요.

- 정확한 금융 용어를 쓰지 마세요. **평소 쓰는 말**이 필요합니다
- 예의 차린 문장으로 다듬지 마세요. 짧고 거칠어도 됩니다
- 서로 다른 방식으로 말하세요 — 같은 말을 조금씩 바꾸지 말고, **다른 사람이 말한 것처럼**
- 나이 든 분이 말할 법한 표현도 섞으세요`;

export const QUERY_SCHEMA = {
  type: "object",
  properties: {
    queries: { type: "array", items: { type: "string" } },
  },
  required: ["queries"],
} as const;

/**
 * <b>이 함수가 이 파일의 전부다.</b> 여기에 라벨이나 동의어가 새면 모델이 그것을
 * 베끼고, 새 세트가 §0과 같은 오염을 그대로 갖는다 — 사람 대신 모델이 베낄 뿐이다.
 *
 * <p>메뉴 id도 안 넣는다. `shinhan.acctinfo`의 `acctinfo`처럼 <b>id에 라벨이 영문으로
 * 박혀 있는</b> 경우가 있다.
 */
export function buildQueryPrompt(envelope: QueryEnvelope, count: number): string {
  const where = envelope.context.length > 0 ? `\n어디에 있는 화면인가: ${envelope.context.join(" > ")}` : "";
  return `이 화면에서 할 수 있는 일: ${envelope.shown}${where}

이 일을 하려고 할 때 뭐라고 말하시겠어요? **${count}가지**로 적어 주세요.`;
}

/** 질의로 인정할 최소 길이(정규화 후). 한두 글자는 질의가 아니라 잡음이다. */
const MIN_CHARS = 3;

/**
 * 받은 것을 그대로 믿지 않는다.
 *
 * <p>봉투만 보고 썼어도 <b>우연히 정답의 글자를 맞힐 수 있다.</b> 금융은 어휘가 좁아
 * 그럴 확률이 낮지 않다. `report:contamination`이 쓰는 것과 같은 필터로 한 번 더 거른다.
 */
export function keepClean(queries: readonly string[], terms: readonly string[]): string[] {
  const kept: string[] = [];
  const seen = new Set<string>();

  for (const raw of queries) {
    // 모델이 따옴표째로 돌려주는 일이 있다. 그대로 두면 정규화가 다르게 걸린다.
    const query = raw.trim().replace(/^["'"']+|["'"']+$/g, "").trim();
    if (normalize(query).length < MIN_CHARS) continue;

    const key = normalize(query);
    if (seen.has(key)) continue;
    if (!isClean(overlap(query, terms))) continue;

    seen.add(key);
    kept.push(query);
  }

  return kept;
}
