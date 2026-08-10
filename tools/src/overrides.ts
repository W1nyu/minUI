import { jamoSimilarity, type MenuItem, type RiskLevel } from "@minui/core";

/**
 * 사람이 붙인 것을 메뉴에 다시 붙이는 로직.
 *
 * <p>이 파일이 따로 있는 이유는 테스트 때문이다. 사이트가 메뉴 문구를 바꿨을 때
 * override가 살아남는지는 말로 주장할 게 아니라 재현해서 보여야 한다.
 */

export interface Override {
  synonyms?: string[];
  riskLevel?: RiskLevel;
  icon?: string;
  cardable?: boolean;
  /** 이 메뉴를 카탈로그에서 뺀다. 메뉴가 아닌 링크(배너·바로가기)를 걸러낼 때. */
  exclude?: boolean;
  /**
   * id가 끊어졌을 때 붙일 기준.
   *
   * <p>신한은행·미래에셋은 사이트가 메뉴 코드를 주지 않아 id를 라벨 경로로 만든다.
   * 로그인 후에도 코드가 없는 것을 확인했다 — 사이트가 문구를 한 글자만 바꿔도
   * id가 달라지고, 그러면 손으로 붙인 동의어가 통째로 죽는다.
   */
  match?: { label: string; category?: string };
}

export interface Remap {
  from: string;
  to: string;
  how: string;
}

export interface Orphan {
  key: string;
  suggestion: string | null;
  score: number;
}

export interface AttachResult {
  resolved: Map<string, Override>;
  remaps: Remap[];
  orphans: Orphan[];
}

/**
 * id가 끊어진 override를 현재 메뉴에 다시 붙일 때의 하한.
 *
 * <p>엔진의 자모 유사도를 그대로 쓴다. 한국어에서 문구가 조금 바뀌는 것
 * ("자동이체 조회/변경/취소" → "자동이체 조회·변경·해지")은 자모 수준에서는 가깝다.
 * 이 값보다 낮으면 다른 메뉴일 가능성이 크므로 자동으로 붙이지 않고 사람에게 넘긴다.
 */
export const REMATCH_FLOOR = 0.82;

/**
 * override를 메뉴에 붙인다. **id가 끊어져도 살아남게 하는 것이 목적이다.**
 *
 * <p>순서에 뜻이 있다.
 * <ol>
 *   <li><b>id 일치</b> — 사이트가 코드를 주는 경우(KB국민은행 `page`, KB증권 `linkcd`)는
 *       여기서 끝난다. 문구가 바뀌어도 코드는 그대로다
 *   <li><b>match.label</b> — 작성자가 명시한 기준. 가장 확실하다
 *   <li><b>자모 유사도</b> — 문구가 조금 바뀐 경우. 엔진이 사용자 발화를 맞출 때 쓰는
 *       바로 그 함수다. 자동으로 붙이되 <b>전부 리포트한다</b> —
 *       엉뚱한 메뉴에 동의어가 붙는 것은 안 붙는 것보다 나쁘다
 * </ol>
 */
export function attachOverrides(
  menus: readonly MenuItem[],
  overrides: Record<string, Override>,
): AttachResult {
  const keys = Object.keys(overrides).filter((key) => !key.startsWith("_"));
  const resolved = new Map<string, Override>();
  const remaps: Remap[] = [];
  const orphans: Orphan[] = [];
  const taken = new Set<string>();

  const byId = new Map(menus.map((menu) => [menu.id, menu]));
  const byLabelCategory = new Map<string, MenuItem[]>();
  const byLabel = new Map<string, MenuItem[]>();

  for (const menu of menus) {
    const lc = `${menu.label}|${menu.category}`;
    byLabelCategory.set(lc, [...(byLabelCategory.get(lc) ?? []), menu]);
    byLabel.set(menu.label, [...(byLabel.get(menu.label) ?? []), menu]);
  }

  for (const key of keys) {
    const override = overrides[key]!;

    const exact = byId.get(key);
    if (exact && !taken.has(exact.id)) {
      resolved.set(exact.id, override);
      taken.add(exact.id);
      continue;
    }

    const wanted = override.match;
    const candidates = wanted
      ? ((wanted.category
          ? byLabelCategory.get(`${wanted.label}|${wanted.category}`)
          : byLabel.get(wanted.label)) ?? [])
      : [];
    const byMatch = candidates.find((menu) => !taken.has(menu.id));
    if (byMatch) {
      resolved.set(byMatch.id, override);
      taken.add(byMatch.id);
      remaps.push({ from: key, to: byMatch.id, how: "match.label" });
      continue;
    }

    // id가 끊어졌다. 엔진의 자모 유사도로 가장 가까운 메뉴를 찾는다.
    let best: MenuItem | null = null;
    let bestScore = 0;
    for (const menu of menus) {
      if (taken.has(menu.id)) continue;
      const score = jamoSimilarity(menu.id, key);
      if (score > bestScore) {
        bestScore = score;
        best = menu;
      }
    }

    if (best && bestScore >= REMATCH_FLOOR) {
      resolved.set(best.id, override);
      taken.add(best.id);
      remaps.push({ from: key, to: best.id, how: `자모 ${bestScore.toFixed(2)}` });
      continue;
    }

    orphans.push({ key, suggestion: best?.id ?? null, score: bestScore });
  }

  return { resolved, remaps, orphans };
}
