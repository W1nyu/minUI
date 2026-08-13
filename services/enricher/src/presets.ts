import type { Gemini } from "./gemini.js";

/**
 * 첫 화면에 무엇을 놓을 것인가.
 *
 * <p>사용 기록이 없는 상태에서 카드 넉 장을 정해야 한다(기획안 F5). 지금까지는 내가 사이트마다
 * 손으로 골랐다 — `sites.ts`의 `presets` 열두 줄이 그것이고, 사이트당 20분쯤 걸렸다.
 *
 * <p>Studio에서는 이것이 <b>LLM이 하는 유일한 즉시 작업</b>이다. 동의어 생성은 색인에
 * 넣지 않기로 했고(해로웠다), 뜻풀이는 나중에 돌려도 되지만, 첫 화면은 없으면
 * 미리보기가 성립하지 않는다. 그리고 한 번의 호출로 끝난다.
 */

export interface PresetMenu {
  menuId: string;
  label: string;
  path?: readonly string[];
}

export interface Presets {
  inquiry: string[];
  transfer: string[];
  invest: string[];
}

export const PRESET_SYSTEM = `금융 앱을 처음 켠 **70대 사용자**의 홈 화면에 큰 카드 넉 장을 놓습니다.
사용 기록이 없으므로 무엇을 자주 쓸지 짐작해서 골라야 합니다.

세 부류로 각각 넉 장을 고르세요.
- inquiry: 주로 조회하려고 앱을 여는 사람
- transfer: 주로 돈을 보내려고 여는 사람
- invest: 주로 상품·투자를 보려고 여는 사람

고르는 기준
- **실제로 자주 쓰는 것**이어야 합니다. 안내·약관·가입 절차 설명은 아닙니다
- 부류마다 넉 장 중 **두세 장은 겹쳐도 됩니다.** 잔액 조회는 누구나 씁니다
- 목록에 없는 번호를 쓰지 마세요`;

export const PRESET_SCHEMA = {
  type: "object",
  properties: {
    inquiry: { type: "array", items: { type: "integer" } },
    transfer: { type: "array", items: { type: "integer" } },
    invest: { type: "array", items: { type: "integer" } },
  },
  required: ["inquiry", "transfer", "invest"],
} as const;

export function buildPresetPrompt(menus: readonly PresetMenu[]): string {
  const lines = menus.map((menu, index) => {
    const where = menu.path && menu.path.length > 0 ? ` (${menu.path.join(" > ")})` : "";
    return `${index}. ${menu.label}${where}`;
  });
  return `메뉴 목록:\n${lines.join("\n")}`;
}

/**
 * 모델 답을 메뉴 id로. **범위 밖 번호는 버리고, 모자라면 앞에서 채운다.**
 *
 * <p>첫 화면이 비는 것이 가장 나쁘다. 모델이 세 개만 주거나 엉뚱한 번호를 줘도
 * 화면은 넉 장이어야 한다.
 */
export function parsePresets(raw: unknown, menus: readonly PresetMenu[], count = 4): Presets {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const pick = (key: string): string[] => {
    const numbers = Array.isArray(answer[key]) ? (answer[key] as unknown[]) : [];
    const out: string[] = [];
    for (const value of numbers) {
      if (typeof value !== "number") continue;
      const menu = menus[value];
      if (menu && !out.includes(menu.menuId)) out.push(menu.menuId);
      if (out.length >= count) break;
    }
    // 모자라면 목록 앞에서 채운다. 사이트가 중요한 것을 앞에 둔다는 가정은 대체로 맞는다.
    for (const menu of menus) {
      if (out.length >= count) break;
      if (!out.includes(menu.menuId)) out.push(menu.menuId);
    }
    return out;
  };

  return { inquiry: pick("inquiry"), transfer: pick("transfer"), invest: pick("invest") };
}

/**
 * 프리셋을 고른다. 호출 한 번이다.
 *
 * @param menus 후보. 전부 넘기면 토큰이 낭비되므로 호출자가 추려서 준다.
 */
export async function pickPresets(
  gemini: Gemini,
  menus: readonly PresetMenu[],
): Promise<Presets> {
  if (menus.length === 0) return { inquiry: [], transfer: [], invest: [] };
  const raw = await gemini.json(PRESET_SYSTEM, buildPresetPrompt(menus), PRESET_SCHEMA);
  return parsePresets(raw, menus);
}
