import type { MinUIConfig } from "../config.js";
import type { MenuId } from "../types.js";
import type { EmbeddingProvider } from "./EmbeddingProvider.js";
import type { LearnedMatch, LearnedTerms } from "./LearnedTerms.js";
import type { IndexedMenu, MenuIndex } from "./MenuIndex.js";
import { jamoSimilarity } from "./hangul.js";
import { DECISIVE, STAGE_STRENGTH, type MatchStage, type SearchCandidate } from "./stages.js";
import { mergeNeural, type NeuralMatch } from "./neural.js";
import { buildReprompt, type RepromptChoice } from "./reprompt.js";
import { normalize } from "./normalize.js";

/*
 * 단계 어휘는 `stages.ts`가 들고 있다 — M11의 `neural.ts`가 같은 것을 써야 하고,
 * 두 벌로 두면 한쪽만 고쳐진다. 여기서 다시 내보내는 것은 부르던 이름을 그대로
 * 두기 위해서다.
 */
export type { MatchStage, SearchCandidate } from "./stages.js";
export type { Reprompt, RepromptChoice } from "./reprompt.js";

export type SearchOutcome =
  | { status: "ok"; query: string; candidates: SearchCandidate[] }
  | {
      status: "unclear";
      query: string;
      /** 되묻기 문구. 열린 질문 대신 선택지를 준다 (기획안 §9.2). */
      prompt: string;
      /**
       * 선택지. **M11에서 문자열에서 묶음으로 바뀌었다.**
       *
       * <p>전에는 카테고리 이름만 넘겨서 화면이 그 이름으로 카탈로그를 다시 걸렀다.
       * 이제 선택지가 갈래 조각(`이체`)일 수 있는데 그것은 카테고리 이름이 아니라,
       * 다시 거르면 아무것도 안 나온다. <b>무엇을 보여 줄지는 고른 쪽이 안다.</b>
       */
      choices: RepromptChoice[];
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
 *   ②' 학습       이 기기의 사용자가 전에 그 말로 갔던 곳 (M7)
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
  readonly #learned: LearnedTerms | undefined;
  #known: ReadonlySet<MenuId> | undefined;

  constructor(
    index: MenuIndex,
    config: MinUIConfig,
    embedding?: EmbeddingProvider,
    /** 이 기기가 배운 표현들 (M7). 없으면 학습 단계가 통째로 빠진다. */
    learned?: LearnedTerms,
  ) {
    this.#index = index;
    this.#config = config;
    this.#embedding = embedding;
    this.#learned = learned;
  }

  /**
   * 문턱을 적용하지 않은 순위. **도우미에게 보여 줄 후보를 추릴 때 쓴다.**
   *
   * <p>`search()`는 확신이 낮으면 후보를 아예 내주지 않는다(§8.3 ⑤). 그것이 사용자에게
   * 보여 줄 때의 옳은 동작이지만, 밖에서 도우미가 고르게 할 때는 <b>낮은 점수라도 순서가
   * 필요하다.</b> 900개를 통째로 넘길 수는 없고, 카탈로그 순서로 앞에서 자르면
   * 아무 관계 없는 메뉴가 후보가 된다.
   *
   * <p>이 함수는 아무것도 열지 않고 아무 판단도 하지 않는다. 순위만 돌려준다.
   */
  rank(query: string, limit: number): SearchCandidate[] {
    const normalized = normalize(query);
    if (normalized.length === 0) return [];
    return this.#scoreAll(normalized).slice(0, limit);
  }

  search(query: string, options: SearchOptions = {}): SearchOutcome {
    const normalized = normalize(query);
    const settings = this.#config.search;

    if (normalized.length === 0) return this.#unclear(query, options);

    const pool = this.#scoreAll(normalized);

    const top = pool.slice(0, settings.maxCandidates);

    // ⑤ 임계치 — 못 넘으면 **그 후보들로** 선택지를 만든다 (M11).
    if (top.length === 0 || top[0]!.score < settings.minConfidence) {
      return this.#unclear(query, options, pool);
    }

    return { status: "ok", query, candidates: top };
  }

  /**
   * 원격이 데려온 후보까지 함께 놓고 다시 판단한다 (M11).
   *
   * <p><b>`search()`를 복제하지 않는다.</b> 두 벌로 두면 문턱과 정렬이 갈라지고,
   * 원격이 있고 없고에 따라 사용자가 보는 순서가 달라진다. 병합만 끼우고 나머지
   * 판단은 같은 코드를 지난다.
   *
   * <p>이 함수는 <b>동기다.</b> 기다리는 일은 `MinUIEngine`이 하고 여기는 이미 온 것을
   * 합치기만 한다 — 그래야 병합 규칙을 픽스처로 잴 수 있다.
   */
  searchMerged(
    query: string,
    remote: readonly NeuralMatch[],
    options: SearchOptions = {},
  ): SearchOutcome {
    const normalized = normalize(query);
    const settings = this.#config.search;

    if (normalized.length === 0) return this.#unclear(query, options);

    const merged = mergeNeural(
      this.#scoreAll(normalized),
      remote,
      settings.neural,
      this.#knownMenuIds(),
      normalized,
    );

    // 자식이 갈래를 이기는 동점 처리는 카탈로그를 알아야 하는 판단이라 여기서 한다.
    merged.sort(
      (a, b) =>
        b.score - a.score ||
        STAGE_STRENGTH[b.matchedBy] - STAGE_STRENGTH[a.matchedBy] ||
        Number(this.#hasChildren(a.menuId)) - Number(this.#hasChildren(b.menuId)) ||
        this.#order(a.menuId) - this.#order(b.menuId),
    );

    const top = merged.slice(0, settings.maxCandidates);
    if (top.length === 0 || top[0]!.score < settings.minConfidence) {
      // 원격이 데려온 것까지 넣어 가른다 — 이 마일스톤에서만 가능한 일이다.
      return this.#unclear(query, options, merged);
    }

    return { status: "ok", query, candidates: top };
  }

  /** 원격이 옛 벡터를 들고 있을 수 있다. 지금 카탈로그에 있는 것만 후보가 된다. */
  #knownMenuIds(): ReadonlySet<MenuId> {
    this.#known ??= new Set(this.#index.menus.map((menu) => menu.menuId));
    return this.#known;
  }


  /**
   * 모든 메뉴에 점수를 매겨 정렬한다. 문턱은 적용하지 않는다.
   *
   * <p>`search()`와 `rank()`가 이것을 함께 쓴다. 나눠 두면 한쪽만 고쳐져
   * 사용자에게 보이는 순서와 도우미가 보는 순서가 달라진다.
   */
  #scoreAll(normalized: string): SearchCandidate[] {
    const semantic = this.#embedding?.similarity(normalized) ?? new Map<MenuId, number>();

    // ②' 이 기기가 배운 표현 (M7). 정확히 같을 때만 걸리므로 메뉴별 점수로 미리 펼친다.
    const learned = new Map<MenuId, LearnedMatch>();
    for (const match of this.#learned?.match(normalized) ?? []) {
      learned.set(match.menuId, match);
    }

    const scored: SearchCandidate[] = [];
    let decided = false;

    for (const menu of this.#index.menus) {
      const candidate = this.#scoreMenu(
        menu,
        normalized,
        semantic.get(menu.menuId) ?? 0,
        learned.get(menu.menuId),
      );
      if (candidate.score <= 0) continue;
      if (DECISIVE.has(candidate.matchedBy)) decided = true;
      scored.push(candidate);
    }

    // ② 정확 매칭이 있으면 거기서 끝낸다. 사전이 확실하다고 말한 것을
    // 유사도 점수로 다시 흔들 이유가 없다. 학습은 여기 끼지 않는다(DECISIVE 참고).
    const pool = decided ? scored.filter((c) => DECISIVE.has(c.matchedBy)) : scored;

    /*
     * 동점이면 **자식 있는 항목을 뒤로 보낸다.**
     *
     * 동의어는 갈래와 자식에 똑같이 걸린다. "환율"이라는 표현은 갈래 `환율`과 자식
     * `환율조회`에 모두 있어 점수가 0.810으로 정확히 같고, 그러면 카탈로그 순서가
     * 순위를 정한다 — 수집 원본이 DOM 순서라 갈래가 언제나 앞이다. 실측에서 놓친 19건 중
     * 3건이 이 동점이었다(환율/펀드 두 건). 점수 체계를 건드리지 않고 순서만 바꾼다.
     *
     * 갈래를 감점하지 않는 이유는, 갈래가 진짜 목적지인 경우가 실재하기 때문이다
     * (KB국민은행 `계좌이체`는 아래에 평범한 이체 화면이 없다). 점수로 눌러 두면 그런
     * 메뉴가 영영 안 나온다. 동점일 때만 양보시키는 것이 근거에 맞는 크기다.
     */
    pool.sort(
      (a, b) =>
        b.score - a.score ||
        Number(this.#hasChildren(a.menuId)) - Number(this.#hasChildren(b.menuId)) ||
        this.#order(a.menuId) - this.#order(b.menuId),
    );
    return pool;
  }

  #scoreMenu(
    menu: IndexedMenu,
    normalized: string,
    semantic: number,
    learned: LearnedMatch | undefined,
  ): SearchCandidate {
    const settings = this.#config.search;
    let best: SearchCandidate = {
      menuId: menu.menuId,
      score: 0,
      matchedBy: "semantic",
      matchedTerm: menu.terms[0] ?? "",
    };

    /*
     * 점수가 같으면 **근거가 강한 단계**를 남긴다.
     *
     * 전에는 먼저 계산된 쪽이 이겼는데, 계산 순서상 의미 유사도가 맨 앞이라
     * 사고가 났다. 라벨이 질의와 완전히 같으면 n-gram 유사도도 1.000이 나오고,
     * 그러면 정확 매칭(1.000)이 `1 > 1`을 통과하지 못해 그 메뉴가 `semantic`으로
     * 분류된다. 바로 다음 줄에서 "정확 매칭이 있으면 정확 매칭만 남긴다"는 필터가
     * 도는데, 정작 <b>가장 정확한 그 메뉴가 후보에서 통째로 빠진다.</b>
     *
     * 실제로 "환율"을 찾으면 `환율`이 사라지고 `환율조회`만 나왔고, "청약"에서는
     * 갈래 `청약`이 semantic 1.000으로 1위를 차지했다. 점수가 아니라 분류가 틀린
     * 것이라 점수만 보고는 알 수 없었다.
     */
    const consider = (score: number, matchedBy: MatchStage, matchedTerm: string) => {
      const better =
        score > best.score ||
        (score === best.score && STAGE_STRENGTH[matchedBy] > STAGE_STRENGTH[best.matchedBy]);
      if (better) best = { menuId: menu.menuId, score, matchedBy, matchedTerm };
    };

    if (semantic > 0) {
      consider(semantic * settings.semanticWeight, "semantic", menu.terms[0] ?? "");
    }

    // ②' 이 기기가 배운 표현. 점수는 관찰 횟수가 정한다(`LearnedTerms`).
    if (learned) consider(learned.score, "learned", learned.term);

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
      const floor = settings.termSpecificityFloor;
      const specificity = floor + (1 - floor) * overlap;

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
  /**
   * 되묻기. **후보를 보고 선택지를 만든다** (M11).
   *
   * <p>전에는 여기가 질의를 아예 보지 않았다 — `categories().slice(0, 3)`을 그대로 냈다.
   * 신한은행에서 "돈 나가는 거 막아줘"라고 말한 사람이 "개인, 기업, 카드 중 어느
   * 것인가요?"를 들었다. 기획안 §9.2가 열어 둔 구멍이 그것이다.
   *
   * @param pool 점수가 매겨진 후보. 없으면 `buildReprompt`가 카테고리로 떨어진다.
   */
  #unclear(query: string, options: SearchOptions, pool: readonly SearchCandidate[] = []): SearchOutcome {
    const settings = this.#config.search.reprompt;
    const { prompt, choices } = buildReprompt(pool, this.#index, {
      ...settings,
      ...(options.maxChoices !== undefined ? { choiceCount: options.maxChoices } : {}),
    });

    return { status: "unclear", query, prompt, choices };
  }

  #order(menuId: MenuId): number {
    return this.#index.menus.findIndex((menu) => menu.menuId === menuId);
  }

  #hasChildren(menuId: MenuId): boolean {
    return this.#index.menus.find((menu) => menu.menuId === menuId)?.hasChildren ?? false;
  }
}
