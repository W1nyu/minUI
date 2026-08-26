import { combineRisk, requiresConfirm } from "./risk.js";
import type { MenuCatalog, MenuId, MenuItem, RiskLevel } from "./types.js";

/**
 * AI 금융 접근성 코파일럿 (M12) — **좁은 역할 셋만 한다.**
 *
 * <ol>
 *   <li>어려운 금융 용어를 쉬운 말로 설명 (`explain`, 이미 있다)
 *   <li>지금 화면에서 할 수 있는 다음 단계 안내 (`nextSteps`)
 *   <li>발화를 <b>검증 가능한</b> 메뉴 id와 제한된 의도로 제안 (`validateProposal`)
 * </ol>
 *
 * <p>이 파일의 요점은 셋째다. 모델이 무엇을 내놓든 <b>화면에 닿기 전에 여기를 지난다.</b>
 * 금지 넷이 여기서 구조로 막힌다 — 규칙으로 적어 두는 것이 아니라 통과할 수 없게 만든다.
 *
 * <pre>
 *   존재하지 않는 메뉴를 만드는 것   → menuId가 카탈로그에 없으면 버린다
 *   위험도를 낮추는 것               → riskLevel은 카탈로그에서만 온다 (combineRisk)
 *   고위험 행동을 자동 실행하는 것    → needsConfirm은 riskLevel에서 계산된다
 *   계좌·금액을 흘리는 것            → 모델이 쓴 글에 숫자가 있으면 버린다
 * </pre>
 *
 * <p><b>화면에 뜨는 글자도 대부분 모델의 것이 아니다.</b> `label`은 카탈로그에서 가져온다 —
 * 모델은 <b>어느 것인지만</b> 고르고, 그것을 뭐라고 부를지는 못 정한다. 모델이 쓴 글은
 * `why` 한 줄뿐이고 그것도 길이와 숫자 검사를 지난다.
 *
 * <p>여기 네트워크도 모델도 없다. 불변 규칙 9 — 코어는 순수하다.
 */

/**
 * 코파일럿이 낼 수 있는 의도. **닫힌 집합이다.**
 *
 * <p>자유 문자열로 두면 검증이라는 말이 무의미해진다. 무엇이 올지 모르면 무엇을 막을지도
 * 모른다. 다섯으로 좁힌 것은 이 앱의 메뉴가 실제로 하는 일이 다섯 갈래이기 때문이고,
 * 늘려야 할 이유가 생기면 <b>여기에 적고</b> 늘린다.
 */
export const COPILOT_INTENTS = ["look", "send", "manage", "learn", "help"] as const;
export type CopilotIntent = (typeof COPILOT_INTENTS)[number];

/** 모델이 쓴 글의 상한. 한 줄이 넘어가면 그것은 설명이 아니라 다른 것이다. */
export const MAX_WHY_CHARS = 60;

export interface CopilotProposal {
  menuId: MenuId;
  /** **카탈로그에서 온다.** 모델이 화면에 쓸 이름을 정하지 못한다. */
  label: string;
  /** **카탈로그가 정한다.** 모델은 올릴 수만 있고 내리지 못한다. */
  riskLevel: RiskLevel;
  /** `riskLevel`에서 계산된다. 모델이 거짓으로 만들 수 없다. */
  needsConfirm: boolean;
  /** 모델이 제안하고 검증을 지났을 때만 있다. 화면이 만든 제안에는 없다. */
  intent?: CopilotIntent;
  /** 모델이 쓴 한 줄. 길이·숫자 검사를 지났을 때만 있다. */
  why?: string;
}

/** 왜 버렸는가. 로그로만 남긴다 — 화면에는 "못 찾았다"만 보이면 된다. */
export type RejectReason =
  | "not-an-object"
  | "unknown-menu"
  | "unknown-intent"
  | "why-too-long"
  | "why-has-digits";

export type Validated =
  | { ok: true; proposal: CopilotProposal }
  | { ok: false; reason: RejectReason };

function isIntent(value: unknown): value is CopilotIntent {
  return typeof value === "string" && (COPILOT_INTENTS as readonly string[]).includes(value);
}

/**
 * 모델이 낸 제안 하나를 **화면에 내보내도 되는 것으로 바꾼다.**
 *
 * <p>돌려주는 것은 입력을 다듬은 것이 아니라 <b>카탈로그에서 다시 만든 것</b>이다.
 * 모델이 준 값 중 살아남는 것은 `menuId`(어느 것인지)와 `intent`·`why`(왜 그런지)뿐이고,
 * 화면이 믿고 쓰는 값(`label`·`riskLevel`·`needsConfirm`)은 전부 우리 쪽에서 계산한다.
 *
 * @param raw 모델 응답. `unknown`으로 받는 것이 요점이다 — 형태를 믿지 않는다.
 */
export function validateProposal(raw: unknown, catalog: MenuCatalog): Validated {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "not-an-object" };
  const value = raw as Record<string, unknown>;

  // ① 없는 메뉴를 만들 수 없다.
  const menuId = value["menuId"];
  const menu = typeof menuId === "string" ? catalog.find((item) => item.id === menuId) : undefined;
  if (!menu) return { ok: false, reason: "unknown-menu" };

  // ② 의도는 닫힌 집합 안에서만.
  const intent = value["intent"];
  if (!isIntent(intent)) return { ok: false, reason: "unknown-intent" };

  // ③ 모델이 쓴 글은 짧아야 하고 숫자가 없어야 한다.
  const why = value["why"];
  let kept: string | undefined;
  if (typeof why === "string" && why.trim().length > 0) {
    const text = why.trim();
    if (text.length > MAX_WHY_CHARS) return { ok: false, reason: "why-too-long" };
    /*
     * 숫자를 통째로 막는다. 금액·계좌번호·전화번호가 여기로 새어 나오는 것을 막는 가장
     * 단순하고 확실한 방법이고, 잃는 것이 거의 없다 — 이 한 줄은 "무엇을 하는 곳인지"를
     * 말하는 자리이지 값을 말하는 자리가 아니다 (절대 보호선 규칙 4).
     */
    if (/[0-9０-９]/u.test(text)) return { ok: false, reason: "why-has-digits" };
    kept = text;
  }

  return { ok: true, proposal: { ...toProposal(menu, value["riskLevel"]), intent, ...(kept ? { why: kept } : {}) } };
}

/** 여럿을 한 번에. 버려진 것은 조용히 빠진다 — 하나가 나쁘다고 나머지를 버리지 않는다. */
export function validateProposals(raw: unknown, catalog: MenuCatalog): CopilotProposal[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<MenuId>();
  const kept: CopilotProposal[] = [];
  for (const item of raw) {
    const checked = validateProposal(item, catalog);
    if (!checked.ok || seen.has(checked.proposal.menuId)) continue;
    seen.add(checked.proposal.menuId);
    kept.push(checked.proposal);
  }
  return kept;
}

/**
 * 카탈로그의 메뉴 하나를 제안으로. **위험도는 여기서만 정해진다.**
 *
 * @param proposedRisk 모델이 위험도를 함께 냈다면 그 값. 더 위험한 쪽이 이긴다.
 */
function toProposal(menu: MenuItem, proposedRisk?: unknown): CopilotProposal {
  const byRule = menu.riskLevel;
  const byModel =
    proposedRisk === "low" || proposedRisk === "medium" || proposedRisk === "high"
      ? proposedRisk
      : byRule;
  const riskLevel = combineRisk(byRule, byModel);

  return {
    menuId: menu.id,
    label: menu.label,
    riskLevel,
    needsConfirm: requiresConfirm(riskLevel),
  };
}

export interface NextStepOptions {
  catalog: MenuCatalog;
  /** 지금 열려 있는 화면. */
  menuId: MenuId;
  /** 몇 개까지. 많으면 그 자체가 또 하나의 메뉴판이 된다. */
  limit?: number;
}

/**
 * 지금 화면에서 **이어서 할 만한 것**. 모델을 부르지 않는다.
 *
 * <p>여기에 LLM이 없는 이유는 Studio가 LLM을 안 쓰는 이유와 같다 — 답이 카탈로그 안에
 * 이미 있고, 결정론이면 같은 화면에서 늘 같은 것이 나오며, <b>지어낼 여지가 없다.</b>
 * 고령 사용자에게 화면이 매번 달라지는 것은 도움이 아니라 벽이다.
 *
 * <p>고르는 규칙은 하나다 — <b>같은 2단 갈래의 형제.</b> 그 갈래를 나눈 사람이 "이것들은
 * 같이 하는 일"이라고 본 것이고, `path`는 되묻기가 이미 그 뜻으로 쓰고 있다.
 * 형제가 없으면 아무것도 내지 않는다. 억지로 채우면 관계 없는 메뉴가 다음 단계인 척한다.
 */
export function nextSteps({ catalog, menuId, limit = 3 }: NextStepOptions): CopilotProposal[] {
  const current = catalog.find((item) => item.id === menuId);
  const path = current?.path;
  if (!current || !path || path.length < 2) return [];

  const key = path.join(">");
  return catalog
    .filter(
      (item) =>
        item.id !== current.id &&
        item.cardable !== false &&
        (item.path?.length ?? 0) >= 2 &&
        item.path!.join(">") === key,
    )
    .slice(0, limit)
    .map((item) => toProposal(item));
}
