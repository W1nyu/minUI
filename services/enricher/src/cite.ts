/**
 * 인용이 **진짜 그 문서의 문장인지** 검사한다. 이 기능의 안전장치가 여기다.
 *
 * <p>근거 있는 설명의 위험은 설명이 틀리는 것이 아니라 <b>출처가 틀리는 것</b>이다.
 * 틀린 설명은 의심이라도 받지만, "[출처: 상품설명서]"가 붙은 틀린 설명은 의심을 지운다.
 * 모델은 문서에 없는 문장을 문서의 문장인 것처럼 매끄럽게 쓸 수 있고, 그것을 프롬프트로
 * 막는 것은 부탁이지 보장이 아니다.
 *
 * <p>그래서 검사는 <b>문자열 대조</b>다. 모델이 낸 인용을 문서 본문에서 실제로 찾고,
 * 못 찾으면 그 답은 근거 없는 답으로 떨어진다. 그리고 화면에 나가는 것은
 * <b>모델이 쓴 문장이 아니라 문서 쪽 원문</b>이다 — 찾았다는 것과 옮겨 적은 것이
 * 같다는 것은 다르고, 한 글자라도 다르면 그것은 이미 인용이 아니다.
 *
 * <p>의존성이 없다. `hint.ts`와 같은 이유다 — 빌드 타임과 런타임이 함께 쓴다.
 */

/** 화면에 함께 나가는 근거. `quote`는 언제나 문서에서 잘라 온 문자열이다. */
export interface Source {
  /** 문서 원문 그대로의 한 조각. 모델이 다시 타이핑한 것이 아니다. */
  quote: string;
  /** 어느 문서인가. 사람이 눌러 확인할 수 있어야 한다. */
  url: string;
  title: string;
}

/**
 * 인용이 이보다 짧으면 근거로 치지 않는다.
 *
 * <p>`"연 0.1%"`는 문서 어디에나 있다. 짧은 조각은 아무 문서에서나 찾아지므로
 * <b>대조를 통과해도 아무것도 보증하지 않는다.</b> 문장이어야 근거다.
 *
 * <p>12자로 뒀다가 20자로 올렸다. 실제로 `자주하는 질문` 메뉴의 근거로 그 쪽의
 * <b>제목 한 줄</b>(`자주하는 질문(FAQ)`, 12자)이 들어왔다 — 문서에 있는 것은 맞지만
 * 아무것도 뒷받침하지 않는다. 제목이 근거가 되면 <b>모든 문서가 자기 제목으로 자기를
 * 증명하게</b> 되고, 그러면 대조는 통과 도장으로만 남는다.
 */
export const QUOTE_MIN = 20;

/**
 * 인용이 이보다 길면 근거로 치지 않는다.
 *
 * <p>문단을 통째로 붙이면 사용자는 안 읽는다. 어려운 말을 풀어 주려고 만든 기능이
 * 어려운 원문을 다시 들이미는 것으로 끝나면 앞뒤가 맞지 않는다.
 */
export const QUOTE_MAX = 120;

/** 대조용 정규형과, 그 각 글자가 원문 어디에서 왔는지. */
interface Normalized {
  text: string;
  /** `text[i]`가 원문의 몇 번째 글자인지. 원문을 되잘라 내려면 이것이 있어야 한다. */
  origin: number[];
}

/**
 * 공백 차이만 지운다. 그 이상은 지우지 않는다.
 *
 * <p>줄바꿈·연속 공백은 문서가 어떻게 접혀 있느냐의 문제라 무시해야 한다. 하지만
 * 구두점이나 조사는 <b>지우면 안 된다</b> — 거기까지 봐주면 "비슷한 문장"이 통과하고,
 * 그러면 이 검사는 통과 도장으로만 남는다.
 */
function normalize(text: string): Normalized {
  let out = "";
  const origin: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined) continue;

    if (/\s/.test(char)) {
      if (out.length > 0 && !out.endsWith(" ")) {
        out += " ";
        origin.push(index);
      }
      continue;
    }
    out += char;
    origin.push(index);
  }

  // 끝의 공백은 대조를 방해만 한다.
  if (out.endsWith(" ")) {
    out = out.slice(0, -1);
    origin.pop();
  }
  return { text: out, origin };
}

/**
 * 인용을 문서에서 찾는다. **찾으면 문서 쪽 원문 조각을 돌려준다.**
 *
 * @returns 문서에 실제로 있는 문장, 없으면 `null`.
 */
export function findQuote(quote: unknown, docText: string): string | null {
  if (typeof quote !== "string") return null;

  const needle = normalize(quote);
  if (needle.text.length < QUOTE_MIN || needle.text.length > QUOTE_MAX) return null;

  const haystack = normalize(docText);
  const at = haystack.text.indexOf(needle.text);
  if (at < 0) return null;

  const from = haystack.origin[at];
  const to = haystack.origin[at + needle.text.length - 1];
  if (from === undefined || to === undefined) return null;

  // 원문 쪽 줄바꿈은 한 칸으로 편다. 화면에서는 한 문장으로 읽혀야 한다.
  return docText.slice(from, to + 1).replace(/\s+/g, " ").trim();
}

/**
 * 근거 하나를 만든다. 인용이 문서에 없으면 `null` — <b>지어낸 출처는 여기서 죽는다.</b>
 */
export function makeSource(
  quote: unknown,
  document: { url: string; title: string; text: string },
): Source | null {
  const found = findQuote(quote, document.text);
  if (found === null) return null;
  return { quote: found, url: document.url, title: document.title };
}
