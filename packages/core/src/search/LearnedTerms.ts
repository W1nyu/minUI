import { DAY_MS, type MinUIConfig } from "../config.js";
import type { LearnedTerm, MenuId } from "../types.js";
import { normalize } from "./normalize.js";

/**
 * 개인 동의어 학습 (M7) — **이 기기의 사용자가 쓴 말.**
 *
 * <p>기획안 §8.3은 동의어 사전을 호스트가 관리하는 것으로 뒀다. 그것으로는 닿지 않는 곳이
 * 있다. 사람마다 같은 기능을 다른 말로 부르고, 그 말은 카탈로그를 쓴 사람이 미리 알 수 없다.
 * `docs/기획안.md` §16이 기록한 실패도 같은 자리에 있다 — 모든 표현을 <b>미리</b> 알아맞히려
 * 했더니 정확도가 85%에서 67%로 떨어졌다. 빗나간 동의어들이 서로를 방해했기 때문이다.
 *
 * <p>그래서 미리 붙이지 않는다. <b>사용자가 실제로 그 말을 하고, 실제로 그 메뉴에 도달한
 * 뒤에</b> 적는다. 그 시점에는 짐작이 아니라 관찰이다.
 *
 * <h3>배우지 않는 것</h3>
 * <p>검색어는 사용자가 친 문장이고, 문장에는 금액과 계좌번호와 사람 이름이 들어온다.
 * 기획안 §11.1이 저장을 금지한 것들이다. 숫자가 든 질의를 통째로 거절하는 것으로 막는다 —
 * 금액도 계좌번호도 날짜도 숫자로 오기 때문이다. "1억 만들기" 같은 표현을 못 배우는
 * 대가를 치르지만, 계좌번호 한 줄이 기기에 남는 것보다 그 편이 싸다.
 *
 * <p>여기 적히는 것은 <b>기기를 떠나지 않는다.</b> 주입된 `StorageAdapter`에만 저장되고,
 * 도우미(`/api/assist`)에게 넘어가는 것은 지금까지처럼 메뉴 후보의 id뿐이다.
 */

/** 저장되는 구조는 `types.ts`에 있다 — 다른 언어로 포팅할 때 함께 넘어가야 하기 때문이다. */
export type { LearnedTerm };

export interface LearnInput {
  /** 사용자가 친(또는 말한) 원문. 여기서 정규화한다. */
  query: string;
  menuId: MenuId;
  /**
   * <b>학습 없이도</b> 검색이 이 메뉴를 이미 1위로 냈는가.
   *
   * <p>이미 찾던 것을 또 적으면 색인만 부푼다. 못 찾았을 때만 배운다.
   * 앞서 배운 덕에 1위가 된 경우는 여기 해당하지 않는다 — 그것은 반복이라는 증거다.
   */
  foundAlready: boolean;
  now: number;
}

export interface LearnedMatch {
  menuId: MenuId;
  term: string;
  score: number;
}

/**
 * 이 표현을 기기에 적어도 되는가. `LearnedTerms` 밖에서도 쓸 수 있게 열어 둔다 —
 * 호스트가 학습 대상을 미리 걸러 보고 싶을 때 같은 판단을 쓰게 하려는 것이다.
 *
 * @param term **정규화된** 표현
 */
export function isLearnable(term: string, config: MinUIConfig): boolean {
  const settings = config.learning;

  // 한 글자 표현은 긴 질의 어디에나 걸린다. 검색 파이프라인이 포함 판정에서
  // 한 글자를 제외하는 것과 같은 이유다.
  if (term.length < 2) return false;
  if (term.length > settings.maxTermChars) return false;

  // 금액·계좌번호·날짜는 전부 숫자로 온다 (기획안 §11.1).
  if (/\d/u.test(term)) return false;

  return true;
}

export class LearnedTerms {
  readonly #config: MinUIConfig;
  /** 정규화된 표현 → 그 표현으로 도달한 메뉴들. 검색 경로가 뜨거워 Map으로 둔다. */
  readonly #byTerm = new Map<string, LearnedTerm[]>();

  constructor(config: MinUIConfig, restored?: readonly LearnedTerm[]) {
    this.#config = config;
    for (const entry of restored ?? []) this.#put({ ...entry });
  }

  /**
   * 검색이 놓친 표현을 배운다.
   *
   * @returns 실제로 적었으면 true. 거절 사유는 남기지 않는다 —
   *          사용자에게 "이건 안 배웠습니다"라고 말할 일이 없기 때문이다.
   */
  learn({ query, menuId, foundAlready, now }: LearnInput): boolean {
    const settings = this.#config.learning;
    if (!settings.enabled) return false;
    if (foundAlready) return false;

    const term = normalize(query);
    if (!isLearnable(term, this.#config)) return false;

    const existing = this.#byTerm.get(term)?.find((entry) => entry.menuId === menuId);
    if (existing) {
      existing.count += 1;
      existing.lastAt = now;
    } else {
      this.#put({ term, menuId, count: 1, lastAt: now });
    }

    this.#evict();
    return true;
  }

  /**
   * 이 질의에 걸리는 학습 표현들. 자주 간 곳부터.
   *
   * <p><b>정확히 같을 때만</b> 걸린다. 포함 판정을 하지 않는 이유는 이 단계의 근거가
   * "사용자가 이 말을 하고 저기로 갔다"는 관찰 하나이기 때문이다. 짧은 학습어가 긴 질의에
   * 걸리기 시작하면 관찰하지 않은 것까지 주장하게 된다.
   *
   * @param normalizedQuery 이미 정규화된 질의
   */
  match(normalizedQuery: string): LearnedMatch[] {
    if (!this.#config.learning.enabled) return [];

    const entries = this.#byTerm.get(normalizedQuery);
    if (!entries) return [];

    return [...entries]
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
      .map((entry) => ({
        menuId: entry.menuId,
        term: entry.term,
        score: this.#score(entry.count),
      }));
  }

  /** 오래 안 쓰인 표현을 버린다. 세션이 열릴 때 부른다. */
  rollup(now: number): void {
    const cutoff = now - this.#config.learning.forgetAfterDays * DAY_MS;
    for (const [term, entries] of this.#byTerm) {
      const alive = entries.filter((entry) => entry.lastAt >= cutoff);
      if (alive.length === entries.length) continue;
      if (alive.length === 0) this.#byTerm.delete(term);
      else this.#byTerm.set(term, alive);
    }
  }

  /** 사용자가 하나를 지운다. */
  forget(term: string, menuId: MenuId): void {
    const entries = this.#byTerm.get(term);
    if (!entries) return;
    const alive = entries.filter((entry) => entry.menuId !== menuId);
    if (alive.length === 0) this.#byTerm.delete(term);
    else this.#byTerm.set(term, alive);
  }

  /** 사용자가 전부 지운다. 되돌릴 수 없다. */
  forgetAll(): void {
    this.#byTerm.clear();
  }

  /** 저장·표시용. 자주 쓴 것부터 — 사용자에게 보여 줄 때의 순서이기도 하다. */
  snapshot(): LearnedTerm[] {
    return [...this.#byTerm.values()]
      .flat()
      .map((entry) => ({ ...entry }))
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  }

  get size(): number {
    let total = 0;
    for (const entries of this.#byTerm.values()) total += entries.length;
    return total;
  }

  #put(entry: LearnedTerm): void {
    const entries = this.#byTerm.get(entry.term);
    if (entries) entries.push(entry);
    else this.#byTerm.set(entry.term, [entry]);
  }

  /**
   * 점수는 관찰 횟수와 함께 오른다. 한 번은 우연일 수 있고, 세 번은 그 사람의 말버릇이다.
   * 상한은 라벨 정확 매칭(1.0) 아래에 둔다.
   */
  #score(count: number): number {
    const { baseScore, scoreStep, maxScore } = this.#config.learning;
    return Math.min(maxScore, baseScore + scoreStep * (count - 1));
  }

  /** 상한을 넘으면 덜 쓰이고 오래된 것부터 버린다. */
  #evict(): void {
    const max = this.#config.learning.maxTerms;
    if (this.size <= max) return;

    const ranked = [...this.#byTerm.values()]
      .flat()
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);

    const survivors = ranked.slice(0, max);
    this.#byTerm.clear();
    for (const entry of survivors) this.#put(entry);
  }
}
