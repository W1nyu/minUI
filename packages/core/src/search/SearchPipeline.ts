import type { MinUIConfig } from "../config.js";
import type { MenuId } from "../types.js";
import type { EmbeddingProvider } from "./EmbeddingProvider.js";
import type { IndexedMenu, MenuIndex } from "./MenuIndex.js";
import { jamoSimilarity } from "./hangul.js";
import { normalize } from "./normalize.js";

/** 어느 단계가 이 후보를 올렸는가. 왜 이게 나왔는지 설명하고 벤치마크를 분석할 때 쓴다. */
export type MatchStage = "exact" | "synonym" | "semantic" | "phonetic";

export interface SearchCandidate {
  menuId: MenuId;
  score: number;
  matchedBy: MatchStage;
  /** 후보를 올린 표현. 사용자에게 "이거 말씀하신 건가요"를 보여줄 근거. */
  matchedTerm: string;
}

export type SearchOutcome =
  | { status: "ok"; query: string; candidates: SearchCandidate[] }
  | {
      status: "unclear";
      query: string;
      /** 되묻기 문구. 열린 질문 대신 선택지를 준다 (기획안 §9.2). */
      prompt: string;
      choices: string[];
    };

export interface SearchOptions {
  /** 되묻기에 쓸 카테고리 수. 너무 많으면 그 자체가 새로운 탐색 문제가 된다. */
  maxChoices?: number;
}

/**
 * 메뉴 검색 파이프라인 (기획안 §8.3).
 *
 *   ① 정규화      조사·어미 제거, NFC
 *   ② 동의어      정확 매칭 — 확실한 것부터, 최우선
 *   ③ 의미 유사도  n-gram TF-IDF (EmbeddingProvider로 교체 가능)
 *   ④ 자모 보정    STT 오인식 복구
 *   ⑤ 임계치      최고 점수가 낮으면 후보를 내지 않고 되묻는다
 *
 * ②가 ③보다 앞에 있는 이유는 기획안에 그대로 적혀 있다 — 금융 도메인의 구어
 * ("떼간다", "빠져나간다")는 범용 유사도가 잘 못 잡는다. 도메인 사전으로 확실한 것을
 * 먼저 처리하고, 사전에 없는 표현만 뒤 단계에 맡긴다.
 *
 * ④를 "보정"으로 둔 것도 의도적이다. 자모 유사도는 짧은 표현이 긴 문장 어딘가에
 * 우연히 걸리기 쉬워서, 단독으로 후보를 만들게 두면 오탐이 는다. 그래서 충분히
 * 높은 점수(phoneticFloor)일 때만, 즉 "거의 맞는데 한두 음절이 어긋난" 경우에만 개입한다.
 */
export class SearchPipeline {
  readonly #index: MenuIndex;
  readonly #config: MinUIConfig;
  readonly #embedding: EmbeddingProvider | undefined;

  constructor(index: MenuIndex, config: MinUIConfig, embedding?: EmbeddingProvider) {
    this.#index = index;
    this.#config = config;
    this.#embedding = embedding;
  }

  search(query: string, options: SearchOptions = {}): SearchOutcome {
    const normalized = normalize(query);
    const settings = this.#config.search;

    if (normalized.length === 0) return this.#unclear(query, options);

    const semantic = this.#embedding?.similarity(normalized) ?? new Map<MenuId, number>();

    const scored: SearchCandidate[] = [];
    let hasExact = false;

    for (const menu of this.#index.menus) {
      const candidate = this.#scoreMenu(menu, normalized, semantic.get(menu.menuId) ?? 0);
      if (candidate.score <= 0) continue;
      if (candidate.matchedBy === "exact") hasExact = true;
      scored.push(candidate);
    }

    // ② 정확 매칭이 있으면 거기서 끝낸다. 사전이 확실하다고 말한 것을
    // 유사도 점수로 다시 흔들 이유가 없다.
    const pool = hasExact ? scored.filter((c) => c.matchedBy === "exact") : scored;

    pool.sort((a, b) => b.score - a.score || this.#order(a.menuId) - this.#order(b.menuId));
    const top = pool.slice(0, settings.maxCandidates);

    // ⑤ 임계치
    if (top.length === 0 || top[0]!.score < settings.minConfidence) {
      return this.#unclear(query, options);
    }

    return { status: "ok", query, candidates: top };
  }

  #scoreMenu(menu: IndexedMenu, normalized: string, semantic: number): SearchCandidate {
    const settings = this.#config.search;
    let best: SearchCandidate = {
      menuId: menu.menuId,
      score: 0,
      matchedBy: "semantic",
      matchedTerm: menu.terms[0] ?? "",
    };

    const consider = (score: number, matchedBy: MatchStage, matchedTerm: string) => {
      if (score > best.score) best = { menuId: menu.menuId, score, matchedBy, matchedTerm };
    };

    if (semantic > 0) {
      consider(semantic * settings.semanticWeight, "semantic", menu.terms[0] ?? "");
    }

    for (const term of menu.terms) {
      if (term === normalized) {
        consider(1, "exact", term);
        continue;
      }

      /**
       * 표현과 질의의 길이가 비슷할수록 강한 근거다.
       *
       * "자동이체 안 나가게"라는 질의는 "이체"와 "자동이체"를 **둘 다** 포함한다.
       * 이 가중치가 없으면 두 메뉴가 동점이 되고, 사용자가 분명히 말한
       * 자동이체 대신 계좌 이체가 카탈로그 순서 덕에 이겨 버린다.
       */
      const overlap =
        Math.min(term.length, normalized.length) /
        Math.max(term.length, normalized.length);
      const specificity = 0.8 + 0.2 * overlap;

      // 한 글자 표현은 긴 문장 어디에나 걸린다. 포함 판정에서 제외한다.
      if (term.length >= 2) {
        if (normalized.includes(term)) {
          consider(settings.containmentScore * specificity, "synonym", term);
          continue;
        }
        if (normalized.length >= 2 && term.includes(normalized)) {
          // 사용자가 앞부분만 말한 경우("자동이체" → "자동이체 해지").
          // 반대 방향보다 근거가 약하므로 조금 낮게 본다.
          consider(settings.partialScore * specificity, "synonym", term);
          continue;
        }
      }

      // ④ 자모 보정 — 글자로는 못 찾았지만 소리로는 가까울 때만 개입한다.
      // 이미 포함으로 찾은 표현에까지 걸면 같은 근거를 두 번 세는 셈이고,
      // "복구"라는 이 단계의 역할과도 맞지 않는다.
      const phonetic = jamoSimilarity(normalized, term);
      if (phonetic >= settings.phoneticFloor) {
        consider(phonetic * settings.phoneticWeight * specificity, "phonetic", term);
      }
    }

    return best;
  }

  /**
   * 되묻기. "무엇을 도와드릴까요" 같은 열린 질문 대신 선택지를 준다 (기획안 §9.2).
   * 막다른 길을 만들지 않는 것이 이 화면의 목적이다 (F4).
   */
  #unclear(query: string, options: SearchOptions): SearchOutcome {
    const choices = this.#index.categories().slice(0, options.maxChoices ?? 3);
    const list = choices.join(", ");

    return {
      status: "unclear",
      query,
      prompt: choices.length > 0 ? `${list} 중에 찾으시는 게 있나요?` : "다시 말씀해 주세요.",
      choices,
    };
  }

  #order(menuId: MenuId): number {
    return this.#index.menus.findIndex((menu) => menu.menuId === menuId);
  }
}
