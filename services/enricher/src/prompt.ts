import type { RiskLevel } from "@minui/core";
import { PERSONAL_DATA, cleanHint } from "./hint.js";

/**
 * LLM에게 무엇을 묻고, 돌아온 것을 어떻게 믿을 것인가.
 *
 * <p>이 파일에 네트워크가 없는 것이 요점이다. 프롬프트를 만드는 일과 응답을 검증하는 일은
 * 순수 함수이고, **검증이야말로 반드시 테스트해야 하는 부분**이다. LLM이 없는 메뉴를
 * 지어내거나 위험도를 낮춰 부르는 것을 여기서 막지 못하면 그대로 카탈로그에 들어간다.
 */

export interface MenuFacts {
  id: string;
  label: string;
  path: readonly string[];
}

export interface Enrichment {
  synonyms: string[];
  riskLevel: RiskLevel;
  cardable: boolean;
  /** 어려운 금융 용어를 풀어 주는 한 줄. 기획안 §15가 지목한 증권 앱의 장벽. */
  hint: string;
}

/**
 * 무엇을 묻는가 — **동의어가 아니라 호칭이다.**
 *
 * <p>규칙 기반으로 두 번 실패했고 이유를 규명했다(`docs/기획안.md` §16).
 * "사용자는 계좌조회를 <b>잔액</b>이라고 부르는데, 라벨에 그 말이 없으니 라벨을 아무리
 * 변형해도 나오지 않는다." 필요한 것은 용어 대응이 아니라 <b>사람이 그것을 뭐라고
 * 부르는가</b>이고, 그 정보는 라벨 안에 없다. LLM은 라벨 바깥의 지식을 가진 유일한 도구다.
 *
 * <p>그래서 프롬프트가 "동의어를 만들어라"가 아니라 "70대가 이걸 뭐라고 말하겠느냐"다.
 */
export const SYSTEM_PROMPT = `당신은 한국 금융 앱의 메뉴를 고령 사용자가 찾을 수 있게 돕는 일을 합니다.

각 메뉴에 대해 네 가지를 답하세요.

1. speech — **70대 사용자가 이 기능을 찾을 때 쓰는 말** 5~8개

   가장 중요한 규칙: **짧게.** 공백을 뺀 글자 수로 2~7자입니다.
   사용자는 검색창에 문장을 치지 않고 낱말을 칩니다.

   좋음: "잔고", "잔액", "통장 확인", "돈 얼마", "입출금"
   나쁨: "통장에 돈이 얼마나 있는지 보기", "여기 은행 돈 얼마 있지"

   - 짧은 것부터 긴 것 순으로 쓰세요. 첫 두 개는 **낱말 하나**로
   - 메뉴 이름을 그대로 쓰지 마세요. 이름은 이미 검색됩니다
   - 금융 용어 대신 생활어를 쓰세요
     "계좌조회" → "잔고", "잔액", "돈 얼마", "통장 확인"
     "자동이체 해지" → "자동이체 끊기", "떼가는 거 그만", "매달 나가는 돈"
     "출금가능금액" → "찾을 돈", "뺄 수 있는 돈"
   - **금융회사 이름을 쓰지 마세요.** 다른 회사 이름은 특히 안 됩니다
   - 이 메뉴에만 해당해야 합니다. 형제 메뉴에도 들어맞는 말은 넣지 마세요

2. risk — 자금이 움직이거나 인증·보안·한도를 바꾸는 메뉴는 "high", 조회만 하면 "low"
   - 잘못 열렸을 때 사용자가 손해를 볼 수 있으면 high입니다
   - 애매하면 high로 하세요

3. cardable — 기본은 **true**입니다. 아래 두 경우에만 false로 하세요
   - 실시간 시세·차트·호가·체결처럼 **내용이 계속 바뀌어** 고정이 무의미한 화면
   - 이 화면 자체로는 아무것도 할 수 없는 순수 안내문(약관, 공지사항)

   "별로 안 쓸 것 같다"는 이유로 false를 주지 마세요. 무엇을 자주 쓰는지는
   실제 사용 기록이 정합니다. 여기서 미리 막으면 그 사람에게 꼭 필요한 메뉴가
   영영 홈에 올라오지 못합니다.

4. hint — 이 메뉴가 무엇인지 한 줄(25자 이내). 어려운 용어를 쉬운 말로 풀어 주세요
   - "예수금" → "증권 계좌에서 바로 뺄 수 있는 돈"
   - 이름만 봐도 아는 메뉴는 빈 문자열로 두세요

주의: 계좌번호·금액·사람 이름을 절대 만들어 넣지 마세요.`;

/** 응답 형식을 모델에 강제한다. 파싱 실패를 애초에 줄인다. */
export const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      i: { type: "integer" },
      speech: { type: "array", items: { type: "string" } },
      risk: { type: "string", enum: ["low", "high"] },
      cardable: { type: "boolean" },
      hint: { type: "string" },
    },
    required: ["i", "speech", "risk", "cardable", "hint"],
  },
} as const;

/**
 * 묶음 하나를 프롬프트로.
 *
 * <p>메뉴 id 대신 **번호**를 준다. `miraeasset.금융상품-펀드-펀드검색` 같은 긴 id를 그대로
 * 보내면 토큰이 배로 들고, 무엇보다 <b>모델이 없는 id를 지어낼 여지</b>가 생긴다.
 * 번호로 받으면 우리가 가진 배열에서 되찾으므로 그 여지가 사라진다.
 */
export function buildUserPrompt(batch: readonly MenuFacts[]): string {
  const lines = batch.map((menu, index) => {
    const where = menu.path.length > 0 ? ` (${menu.path.join(" > ")})` : "";
    return `${index}. ${menu.label}${where}`;
  });
  return `다음 메뉴들을 처리하세요. 번호를 그대로 i에 넣으세요.\n\n${lines.join("\n")}`;
}

// ── 검증 ─────────────────────────────────────────────────────────────────

/**
 * 회사 이름을 **떼어낸다.** 버리지 않는다.
 *
 * <p>실측에서 KB국민은행 메뉴에 `"우리은행 돈 보기"`가 붙었다 — 다른 은행 이름은
 * 그냥 틀린 정보다. 그런데 문구를 통째로 버렸더니 `"국민은행 잔액"`까지 날아가고
 * `"은행 잔고"` 같은 껍데기만 남았다. <b>고치려던 것보다 더 나빠졌다.</b>
 *
 * <p>이름만 떼면 둘 다 쓸 만해진다 — `"국민은행 잔액"` → `"잔액"`,
 * `"우리은행 돈 보기"` → `"돈 보기"`. 어차피 그 앱 안에서 찾는 것이라 회사 이름은
 * 변별력이 0이고, 떼어 내면 남는 말이 진짜 찾는 말이다.
 */
const BRAND =
  /(국민|신한|하나|우리|농협|기업|산업|수협|씨티|제일|카카오|케이|토스|미래에셋|삼성|한국투자|키움|대신|메리츠|유안타|KB|IBK|NH|SC|BNK|DGB|JB)?\s*(은행|증권|뱅크)/g;

/** 떼어 낸 뒤에도 남아 있는 브랜드. 이건 버린다. */
const BRAND_ALONE = /미래에셋|카카오|토스|키움|메리츠|유안타|한국투자/;

export interface ParseReport {
  /** 번호 → 보강 결과. 검증을 통과한 것만 들어간다. */
  accepted: Map<number, Enrichment>;
  /** 무엇을 왜 버렸는가. 모델이 어떻게 어긋나는지 보려면 이것을 봐야 한다. */
  rejected: { index: number; reason: string }[];
}

/**
 * 모델 응답을 검증한다. **믿지 않는 것이 기본이다.**
 *
 * <p>여기서 막는 것들.
 * <ul>
 *   <li>범위 밖 번호 — 없는 메뉴를 지어낸 경우
 *   <li>메뉴 이름을 그대로 되돌려 준 동의어 — 검색에 아무것도 더하지 않는다
 *   <li>개인정보 형태의 문자열
 *   <li>너무 길거나 짧은 것
 * </ul>
 *
 * <p><b>riskLevel은 여기서 검증하지 않는다.</b> 낮추는 것을 막는 일은 호출자가
 * 정규식 판정과 합쳐서 한다 — 안전 경계는 한 곳에서만 결정되어야 한다.
 */
export function parseResponse(raw: unknown, batch: readonly MenuFacts[]): ParseReport {
  const accepted = new Map<number, Enrichment>();
  const rejected: ParseReport["rejected"] = [];

  if (!Array.isArray(raw)) {
    return { accepted, rejected: [{ index: -1, reason: "배열이 아님" }] };
  }

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      rejected.push({ index: -1, reason: "객체가 아님" });
      continue;
    }
    const item = entry as Record<string, unknown>;
    const index = typeof item["i"] === "number" ? item["i"] : Number.NaN;
    const menu = batch[index];

    if (!menu) {
      rejected.push({ index, reason: "없는 번호 — 모델이 지어냈다" });
      continue;
    }
    if (accepted.has(index)) {
      rejected.push({ index, reason: "번호 중복" });
      continue;
    }

    const synonyms = cleanSynonyms(item["speech"], menu);
    const risk = item["risk"] === "high" ? "high" : "low";
    const cardable = item["cardable"] !== false;
    const hint = cleanHint(item["hint"], menu.label);

    if (synonyms.length === 0 && hint.length === 0) {
      rejected.push({ index, reason: "쓸 만한 것이 없음" });
      continue;
    }

    accepted.set(index, { synonyms, riskLevel: risk, cardable, hint });
  }

  return { accepted, rejected };
}

function cleanSynonyms(value: unknown, menu: MenuFacts): string[] {
  if (!Array.isArray(value)) return [];
  const squash = (text: string) => text.replace(/[\s/·]+/g, "").toLowerCase();
  const label = squash(menu.label);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    // 회사 이름을 먼저 떼어 낸다. 남는 말이 진짜 찾는 말이다.
    const phrase = candidate.replace(BRAND, " ").replace(/\s+/g, " ").trim();
    if (BRAND_ALONE.test(phrase)) continue;

    const key = squash(phrase);

    /*
     * 긴 것은 버린다. 파이프라인의 포함 판정이 짧은 말에 유리하기 때문이다 —
     * `"돈 얼마 있어"`(6자)는 질의 `"잔액"`을 포함하지도, 거기 포함되지도 않아 매칭이 0이다.
     * 실측에서 사람이 쓴 동의어는 평균 4.4자, LLM은 6.7자였고 정확도가 80% 대 27%로 갈렸다.
     * 프롬프트로 짧게 쓰라고 이르되, 지키지 않은 것은 여기서 버린다.
     */
    if (key.length < 2 || key.length > 9) continue;
    // 메뉴 이름을 그대로 돌려준 것은 검색에 아무것도 더하지 않는다.
    if (key === label) continue;
    if (PERSONAL_DATA.some((pattern) => pattern.test(phrase))) continue;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);

    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 정규식 판정과 모델 판정을 합친다. **더 위험한 쪽을 택한다.**
 *
 * <p>모델이 `high`를 `low`로 낮추지 못하게 하는 것이 이 함수의 전부다.
 * 기획안 §9.3의 안전 경계가 모델 판단에 걸리면 안 된다 — 음성으로 이체가 실행되는 경로가
 * 열리는 것이고, 그것은 재 볼 성질의 문제가 아니다.
 */
/*
 * 구현은 `@minui/core`로 옮겼다 — 규칙 8은 코어의 불변 규칙이고 `RiskLevel`도 거기 있다.
 * 여기서 다시 내보내는 것은 부르던 이름을 그대로 두기 위해서다.
 */
export { combineRisk } from "@minui/core";
