import { EventStore } from "./EventStore.js";
import { LayoutStabilizer } from "./LayoutStabilizer.js";
import { RankingEngine } from "./RankingEngine.js";
import { DEFAULT_PROFILE, coldStartCards, isColdStart } from "./coldStart.js";
import { type MinUIConfig, type PartialConfig, resolveConfig } from "./config.js";
import { LearnedTerms } from "./search/LearnedTerms.js";
import { MenuIndex } from "./search/MenuIndex.js";
import { NgramTfIdfProvider } from "./search/NgramTfIdfProvider.js";
import { SearchPipeline, type SearchOutcome } from "./search/SearchPipeline.js";
import { resolveVoiceAction, type VoiceAction } from "./search/voiceAction.js";
import type { EmbeddingProvider } from "./search/EmbeddingProvider.js";
import type { NeuralMatch, NeuralRetriever } from "./search/neural.js";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter.js";
import type {
  ActionHandler,
  CardExplanation,
  Clock,
  ColdStartPresets,
  ColdStartProfile,
  LayoutState,
  LearnedTerm,
  MenuCatalog,
  MenuId,
  MenuItem,
  PersistedState,
  RankedCard,
  ScoreBreakdown,
  SlotExtractor,
  Slots,
  StorageAdapter,
  UsageEvent,
} from "./types.js";

/** 2 — M7이 `learned`를 더했다. 없는 저장본은 빈 목록으로 읽는다. */
const STATE_VERSION = 2;

export interface MinUIEngineOptions {
  /** 이식 계약 ① */
  catalog: MenuCatalog;
  /** 이식 계약 ② */
  onAction: ActionHandler;
  /** 이식 계약 ③ (선택). 기본은 세션 메모리 */
  storage?: StorageAdapter;
  config?: PartialConfig;
  /** 시각 주입. 테스트와 결정론을 위해 엔진은 Date.now()를 직접 부르지 않는다 */
  now?: Clock;
  coldStartPresets?: ColdStartPresets;
  /**
   * 의미 매칭 구현체. 생략하면 카탈로그에서 n-gram 색인을 즉석에서 만든다.
   * 빌드 타임에 만든 색인을 쓰려면 `NgramTfIdfProvider.fromJSON(...)`을 넘긴다.
   */
  embedding?: EmbeddingProvider;
  /**
   * 이식 계약 ④ (선택) — 발화에서 화면에 미리 채울 값을 뽑는다 (M9, §9.3).
   *
   * <p>엔진은 무엇을 채우는지 모른다. 수취인·계좌 별명은 호스트만 아는 것이고, 도메인이
   * 엔진에 들어오면 이식성이 사라진다. 한국어를 읽는 부분은 `parseAmount`·`pickFromList`가
   * 돕는다.
   *
   * <p>주지 않으면 프리필이 붙지 않을 뿐 나머지는 그대로 돈다. 던져도 마찬가지다.
   */
  slots?: SlotExtractor;
  /**
   * 이식 계약 ⑤ (선택) — 원격 신경망 검색 (M11, 기획안 §8.3 ③').
   *
   * <p>`assist`와 같은 모양의 계약이다 — <b>엔진은 이것이 신경망인지 사전인지 사람인지
   * 모른다.</b> URL도 키도 모델 이름도 여기로 오지 않는다 (불변 규칙 9).
   *
   * <p><b>`assist`와 겹치지 않는다.</b> `assist`는 이미 가진 후보 중 하나를 고르고,
   * 이것은 <b>로컬이 0점을 준 메뉴를 데려온다.</b> "돈 보내다"와 "이체"는 글자가 하나도
   * 안 겹쳐 n-gram이 0을 주고, 그래서 후보 목록에 애초에 없다 — 고르게 해서는 되찾을 수
   * 없는 것을 되찾는 자리다.
   *
   * <p>주지 않으면 검색이 지금까지와 <b>바이트 단위로 같게</b> 돈다. 던져도, 늦어도
   * 마찬가지다.
   */
  retrieve?: NeuralRetriever;
}

/**
 * 호스트 앱이 만지는 유일한 진입점.
 *
 * 여기서 하는 일은 조립뿐이다 — 점수는 RankingEngine이, 화면이 언제 바뀌는지는
 * LayoutStabilizer가, 기록은 EventStore가 정한다. 이 클래스가 판단 로직을 갖기 시작하면
 * 각 규칙을 따로 테스트할 수 없게 된다.
 *
 * 생명주기 규약:
 *   create()로 세션을 열고 → 세션 내내 getCards()는 같은 값을 낸다 → close()로 닫는다.
 *   재배치 결정은 create() 시점에 한 번만 이뤄지며, 그 결과는 *다음* 세션에 보인다.
 */
export class MinUIEngine {
  readonly #config: MinUIConfig;
  readonly #catalog: MenuCatalog;
  readonly #byId: ReadonlyMap<MenuId, MenuItem>;
  readonly #onAction: ActionHandler;
  readonly #storage: StorageAdapter;
  readonly #clock: Clock;
  readonly #presets: ColdStartPresets | undefined;
  readonly #slots: SlotExtractor | undefined;

  readonly #events: EventStore;
  readonly #ranking: RankingEngine;
  readonly #stabilizer: LayoutStabilizer;
  readonly #search: SearchPipeline;
  readonly #retrieve: NeuralRetriever | undefined;
  readonly #learned: LearnedTerms;

  #layout: LayoutState;
  #pinned: MenuId[];
  #profile: ColdStartProfile;
  #sessionCount: number;
  /** 저장을 직렬화한다. 병렬 save가 서로를 덮어쓰는 것을 막는다. */
  #saveChain: Promise<void> = Promise.resolve();
  #lastSaveError: unknown;

  private constructor(options: MinUIEngineOptions, restored: PersistedState | null) {
    this.#config = resolveConfig(options.config);
    this.#catalog = options.catalog;
    this.#byId = new Map(options.catalog.map((m) => [m.id, m]));
    this.#onAction = options.onAction;
    this.#storage = options.storage ?? new MemoryStorageAdapter();
    this.#clock = options.now ?? (() => Date.now());
    this.#presets = options.coldStartPresets;
    this.#slots = options.slots;

    this.#events = new EventStore(
      this.#config,
      restored ? { visits: restored.visits, aggregates: restored.aggregates } : undefined,
    );
    this.#ranking = new RankingEngine(this.#config, this.#events);
    this.#stabilizer = new LayoutStabilizer(this.#config);

    this.#learned = new LearnedTerms(this.#config, restored?.learned);

    const index = new MenuIndex(options.catalog);
    this.#retrieve = options.retrieve;
    this.#search = new SearchPipeline(
      index,
      this.#config,
      options.embedding ?? NgramTfIdfProvider.build(index.documents()),
      this.#learned,
    );

    this.#pinned = restored ? [...restored.pinned] : [];
    this.#profile = restored?.profile ?? DEFAULT_PROFILE;
    this.#sessionCount = (restored?.sessionCount ?? 0) + 1;
    this.#layout = restored?.layout ?? {
      current: [],
      pending: null,
      lastRecomputedAt: 0,
      introducedAt: {},
    };
  }

  static async create(options: MinUIEngineOptions): Promise<MinUIEngine> {
    const storage = options.storage ?? new MemoryStorageAdapter();
    const restored = await storage.load();
    const engine = new MinUIEngine({ ...options, storage }, restored);
    await engine.#beginSession();
    return engine;
  }

  /**
   * 세션 시작 시 한 번만 일어나는 일들. 순서에 의미가 있다.
   *  1) 대기 중이던 구성을 화면에 올린다 (이때가 카드가 바뀌는 시점)
   *  2) 보존 기간이 지난 기록을 접는다
   *  3) 다음 세션에 쓸 구성을 계산해 둔다
   */
  async #beginSession(): Promise<void> {
    const now = this.#clock();

    this.#layout = this.#stabilizer.startSession(this.#layout, now);
    this.#events.rollup(now);
    this.#learned.rollup(now);

    if (this.#layout.current.length === 0) {
      // 최초 실행: 온보딩 프로파일로 첫 화면을 만든다.
      this.#layout = this.#stabilizer.recompute(
        this.#layout,
        this.#coldStartRanking(now),
        now,
      ).state;
    } else if (!this.#inColdStart() || this.#config.stability.liveReorder) {
      this.#layout = this.#stabilizer.recompute(
        this.#layout,
        this.#rankingNow(now),
        now,
      ).state;
    }

    this.#persist();
    await this.flush();
  }

  // ── 호스트가 부르는 것들 ────────────────────────────────────────────────

  /** 홈에 그릴 카드. 세션 내내 같은 값을 낸다. */
  getCards(): RankedCard[] {
    return this.#stabilizer.cards(
      this.#layout,
      this.#rank(this.#clock()),
      this.#pinned,
      this.#clock(),
    );
  }

  /** 전체 메뉴. 카드에 없는 기능도 100% 도달 가능해야 한다 (원칙 P2). */
  getAllMenus(): MenuCatalog {
    return this.#catalog;
  }

  getMenu(menuId: MenuId): MenuItem | undefined {
    return this.#byId.get(menuId);
  }

  /** 카드/전체메뉴/검색 어디서 왔든 메뉴를 여는 단일 경로. */
  open(menuId: MenuId, params?: Record<string, unknown>): void {
    if (!this.#byId.has(menuId)) return;
    this.recordEvent({ type: "menu_enter", menuId });
    if (this.#config.stability.liveReorder) this.#applyForced();
    this.#onAction(menuId, params);
  }

  /** 호스트가 "이 화면에서 할 일을 끝냈다"고 알리는 지점. */
  complete(menuId: MenuId): void {
    this.recordEvent({ type: "task_complete", menuId });
    // 완료는 방문보다 무겁게 세므로(incompleteVisitWeight) 점수가 여기서 또 움직인다.
    if (this.#config.stability.liveReorder) this.#applyForced();
  }

  // ── 검색·음성 ───────────────────────────────────────────────────────────

  /**
   * 메뉴 검색. **이 함수는 어떤 화면도 열지 않는다.**
   * 무엇을 할지는 `voiceAction()`이 정하고, 실제로 여는 것은 호스트의 탭이다.
   */
  search(query: string): SearchOutcome {
    return this.#search.search(query);
  }

  /**
   * 문턱 없이 추린 후보. **호스트가 바깥 도우미에게 넘길 때 쓴다.**
   *
   * <p>`search()`가 되묻기를 냈다는 것은 확신이 낮다는 뜻이지 순서가 없다는 뜻은 아니다.
   * 900개를 통째로 넘길 수 없고 카탈로그 순서로 자르면 관계없는 메뉴가 후보가 되므로,
   * 낮은 점수라도 순위가 필요하다. 이 함수는 아무것도 열지 않는다.
   */
  candidates(query: string, limit = 20): MenuId[] {
    return this.#search.rank(query, limit).map((candidate) => candidate.menuId);
  }

  /**
   * 검색 결과를 화면 동작으로 바꾼다. 기획안 §9.3의 안전 경계가 여기서 적용된다 —
   * `riskLevel: "high"` 메뉴는 어떤 확신 수준에서도 자동으로 열리지 않는다.
   *
   * @param sttConfidence 음성 인식 신뢰도. 텍스트 검색이면 생략한다.
   */
  voiceAction(query: string, sttConfidence?: number): VoiceAction {
    return this.#act(this.search(query), sttConfidence);
  }

  /**
   * 원격까지 물어보고 검색한다 (M11).
   *
   * <p><b>이 함수가 지는 책임은 둘뿐이다 — 시간 초과와 예외.</b> 무엇을 어떻게 합칠지는
   * `mergeNeural`(순수·동기)이 정하고 픽스처가 잰다. 비동기 코드는 픽스처로 재기 어렵고
   * 다른 언어로 옮길 때 통째로 다시 써야 하므로, 판단을 여기 두지 않는다.
   *
   * <p>어떤 경로로도 <b>로컬 결과보다 나빠지지 않는다.</b> 원격이 없거나, 꺼져 있거나,
   * 던지거나, 늦으면 `search()`와 같은 것이 나온다 — 불변 규칙 9는 "돈다"가 아니라
   * "<b>같게</b> 돈다"여야 한다.
   */
  async searchWithRetrieval(query: string): Promise<SearchOutcome> {
    const local = this.search(query);
    const settings = this.#config.search.neural;
    if (!this.#retrieve || !settings.enabled) return local;

    /*
     * 로컬이 확신했으면 묻지 않는다. 85%의 질의가 여기서 끝나고(§12.6), 그때마다 서버를
     * 부르면 값도 지연도 낭비다. 되묻기(`unclear`)는 확신이 없다는 뜻이므로 언제나 묻는다.
     */
    if (local.status === "ok" && (local.candidates[0]?.score ?? 0) >= settings.consultBelow) {
      return local;
    }

    const remote = await this.#askRemote(query);
    if (!remote) return local;

    return this.#search.searchMerged(query, remote);
  }

  /** 원격까지 물어보고 화면 동작까지 정한다 (M11). */
  async voiceActionWithRetrieval(query: string, sttConfidence?: number): Promise<VoiceAction> {
    return this.#act(await this.searchWithRetrieval(query), sttConfidence);
  }

  /**
   * 안전 경계는 <b>한 함수만</b> 지난다.
   *
   * <p>`voiceAction`과 `voiceActionWithRetrieval`이 각자 `resolveVoiceAction`을 부르면
   * 언젠가 한쪽만 고쳐지고, §9.3이 한쪽에서만 지켜진다.
   */
  #act(outcome: SearchOutcome, sttConfidence?: number): VoiceAction {
    return resolveVoiceAction({
      outcome,
      menus: this.#byId,
      config: this.#config,
      ...(sttConfidence !== undefined ? { sttConfidence } : {}),
      ...(this.#slots ? { slots: this.#slots } : {}),
    });
  }

  /**
   * 원격에 묻는다. 실패는 전부 `null`이고, 부른 쪽이 로컬 결과를 이미 들고 있다.
   *
   * <p><b>여기서 시간을 재지 않는다.</b> 처음에는 `setTimeout`으로 상한을 뒀는데
   * `portability.test.ts`가 잡았다 — 불변 규칙 1은 core가 Node·브라우저 전역에 손대는
   * 것을 금한다. 엔진이 `Date.now()` 대신 주입된 `now`를 쓰는 것과 같은 이유이고,
   * 그 테스트가 옳다. <b>시계를 가진 층이 시간을 재야 한다.</b>
   *
   * <p>그래서 상한은 `packages/react`의 `MinUIProvider`가 `neural.timeoutMs`를 읽어
   * 씌운다. 값 자체는 `MinUIConfig`에 남아 있어야 한다(규칙 3) — 다른 언어로 포팅할 때
   * 그 층이 같은 값을 같은 자리에서 읽는다.
   *
   * <p>고령 사용자에게 <b>침묵은 고장으로 읽힌다.</b> 상한이 없으면 안 되는 이유가
   * 그것이고, 그 책임이 어느 층에 있는지가 여기서 갈린다.
   */
  async #askRemote(query: string): Promise<readonly NeuralMatch[] | null> {
    try {
      return await this.#retrieve!(query);
    } catch {
      return null;
    }
  }

  /**
   * 이 발화로 이 메뉴를 열 때 미리 채울 값 (M9).
   *
   * <p>후보 목록에서 사용자가 <b>고른 뒤에</b> 호스트가 부른다. `voiceAction`이 후보 제시에
   * 프리필을 붙이지 않는 이유가 여기 있다 — 어느 후보를 고를지 모르는 상태에서는 채울 값도
   * 정해지지 않는다.
   *
   * <p>화면을 열지 않는다. 여는 것은 지금까지처럼 `open()`이고, `riskLevel: high`는
   * 이 값이 있든 없든 사용자의 탭을 거친다.
   */
  prefillFor(query: string, menuId: MenuId): Slots {
    if (!this.#slots || !this.#byId.has(menuId)) return {};
    try {
      return this.#slots(query, menuId);
    } catch {
      // 호스트 코드가 던져도 음성 경로가 죽으면 안 된다. 프리필은 편의이지 전제가 아니다.
      return {};
    }
  }

  recordEvent(event: UsageEvent): void {
    this.#events.record(event, this.#clock());
    this.#persist();
  }

  // ── 개인 동의어 학습 (M7) ───────────────────────────────────────────────

  /**
   * **검색 결과에서** 사용자가 이 메뉴를 골랐다고 알린다.
   *
   * <p>카드 탭이나 전체 메뉴에서 연 것과 반드시 구분해야 한다. 검색을 거치지 않은 진입은
   * 그 질의가 그 메뉴를 뜻한다는 근거가 아니다 — 시각으로 짝을 맞추면 검색해 놓고 마음이
   * 바뀌어 카드를 누른 경우까지 배우게 된다. 그래서 <b>질의와 메뉴를 함께 받는다.</b>
   *
   * <p>화면을 열지 않는다. 여는 것은 지금까지처럼 `open()`이다 — 이 함수가 화면까지
   * 열면 §9.3의 안전 경계를 우회하는 두 번째 경로가 생긴다.
   *
   * <p>호스트가 따로 할 일은 없다. `@minui/react`의 말로 찾기 화면이 이미 부른다.
   */
  noteSearchChoice(query: string, menuId: MenuId): void {
    if (!this.#byId.has(menuId)) return;

    /*
     * 이미 1위로 내주던 것을 또 적으면 색인만 부푼다.
     *
     * 단, **학습으로 1위가 된 것은 "이미 찾던 것"이 아니다.** 그것까지 걸러 내면 횟수가
     * 영영 1에서 멈춰 반복이 점수에 반영되지 않는다 — 한 번 눌러 본 것과 석 달째 쓰는 말이
     * 같은 무게가 된다. 카탈로그가 스스로 찾아내는 것만 걸러야 한다.
     */
    const top = this.#search.search(query);
    const first = top.status === "ok" ? top.candidates[0] : undefined;
    const foundAlready = first?.menuId === menuId && first.matchedBy !== "learned";

    if (this.#learned.learn({ query, menuId, foundAlready, now: this.#clock() })) {
      this.#persist();
    }
  }

  /** 이 기기가 배운 표현들. 자주 쓴 것부터. 보여 주는 화면은 호스트가 만든다. */
  getLearnedTerms(): readonly LearnedTerm[] {
    return this.#learned.snapshot();
  }

  /** 사용자가 하나를 지운다. 즉시 반영한다 — 나중에 사라지는 탈출구는 탈출구가 아니다. */
  async forgetTerm(term: string, menuId: MenuId): Promise<void> {
    this.#learned.forget(term, menuId);
    this.#persist();
    await this.flush();
  }

  /** 사용자가 전부 지운다. 되돌릴 수 없다. */
  async forgetAllTerms(): Promise<void> {
    this.#learned.forgetAll();
    this.#persist();
    await this.flush();
  }

  // ── 수동 고정 ───────────────────────────────────────────────────────────

  isPinned(menuId: MenuId): boolean {
    return this.#pinned.includes(menuId);
  }

  getPinned(): readonly MenuId[] {
    return this.#pinned;
  }

  /**
   * 사용자가 직접 일으킨 변경이므로 즉시 반영한다.
   * 24시간 뒤에 열리는 탈출구는 탈출구가 아니다.
   */
  async pin(menuId: MenuId): Promise<void> {
    if (!this.#byId.has(menuId) || this.#pinned.includes(menuId)) return;
    this.#pinned = [...this.#pinned, menuId];
    this.#applyForced();
    await this.flush();
  }

  /** 고정을 풀어도 카드는 그 자리에 남는다. 손댔더니 사라지는 UI는 신뢰를 잃는다. */
  async unpin(menuId: MenuId): Promise<void> {
    if (!this.#pinned.includes(menuId)) return;
    this.#pinned = this.#pinned.filter((id) => id !== menuId);
    this.#persist();
    await this.flush();
  }

  // ── 온보딩 ──────────────────────────────────────────────────────────────

  getProfile(): ColdStartProfile {
    return this.#profile;
  }

  async setProfile(profile: ColdStartProfile): Promise<void> {
    this.#profile = profile;
    // 온보딩 직후, 아직 첫 화면이 사용자의 답을 반영하지 못했다면 다시 만든다.
    if (this.#inColdStart()) {
      const now = this.#clock();
      this.#layout = {
        ...this.#layout,
        current: coldStartCards(
          this.#catalog,
          profile,
          Math.min(this.#config.cards.count, this.#config.cards.max),
          this.#presets,
        ),
        pending: null,
        lastRecomputedAt: now,
      };
    }
    this.#persist();
    await this.flush();
  }

  // ── 설명 (M8) ───────────────────────────────────────────────────────────

  /**
   * 지금 카드가 **왜** 그 자리에 있는지. `getCards()`와 같은 순서로 준다.
   *
   * <p>이 판단이 엔진에 있어야 하는 이유는 `getCards()`가 엔진에 있는 이유와 같다.
   * UI가 점수를 다시 해석하기 시작하면 <b>화면이 하는 설명과 엔진의 판단이 갈린다</b> —
   * 그때 사용자는 틀린 설명을 듣게 되고, 틀린 설명은 없는 설명보다 나쁘다.
   *
   * <p>문구는 만들지 않는다. 무엇 때문인지와 얼마인지만 주고 말은 호스트가 고른다.
   */
  explainCards(): CardExplanation[] {
    const now = this.#clock();
    const scores = new Map(this.#rank(now).map((entry) => [entry.menuId, entry]));

    return this.getCards().map((card): CardExplanation => {
      const score = scores.get(card.menuId);
      return {
        menuId: card.menuId,
        isNew: card.isNew,
        // 순서에 뜻이 있다. 고정은 사용자가 직접 정한 것이라 언제나 먼저다 —
        // 많이 쓴 카드를 고정했을 때 "많이 쓰셔서요"라고 답하면, 사용자가 한 일이
        // 화면에서 지워진다.
        reason: card.pinned
          ? { kind: "pinned" }
          : score && score.views > 0
            ? { kind: "used", views: score.views, lastUsedAt: score.lastUsedAt ?? now }
            : { kind: "preset" },
      };
    });
  }

  // ── 진단용 ──────────────────────────────────────────────────────────────

  /** 어떤 카드가 왜 그 자리에 있는지 — **점수**. 측정(M5)과 디버깅에 쓴다. */
  explain(): ScoreBreakdown[] {
    return this.#rank(this.#clock());
  }

  inColdStart(): boolean {
    return this.#inColdStart();
  }

  get sessionCount(): number {
    return this.#sessionCount;
  }

  /**
   * 저장이 끝날 때까지 기다린다. 저장에 실패했다면 여기서 알린다 —
   * 사용 이력이 사라지는 것은 조용히 넘어갈 일이 아니다.
   */
  async flush(): Promise<void> {
    await this.#saveChain;
    const error = this.#lastSaveError;
    if (error) {
      this.#lastSaveError = undefined;
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.flush();
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  #rank(now: number): ScoreBreakdown[] {
    return this.#ranking.scoreAll({
      catalog: this.#catalog,
      now,
      pinned: this.#pinned,
    });
  }

  /**
   * 기록이 없을 때 쓰는 가짜 랭킹. 프리셋 순서를 점수로 바꿔 LayoutStabilizer에 넘긴다.
   * 최초 배치 경로를 프리셋 전용으로 따로 만들지 않으려는 것 — 경로가 하나면 규칙도 하나다.
   */
  #coldStartRanking(now: number): ScoreBreakdown[] {
    const preset = coldStartCards(
      this.#catalog,
      this.#profile,
      this.#catalog.length,
      this.#presets,
    );
    const real = new Map(this.#rank(now).map((r) => [r.menuId, r]));

    return preset.map((menuId, index) => {
      const base = real.get(menuId);
      return {
        menuId,
        frequency: 0,
        recency: 0,
        context: 0,
        pin: base?.pin ?? 0,
        // 프리셋 순서를 유지하되, 고정된 메뉴는 그 위로 올라오게 한다.
        total: (base?.pin ?? 0) + (preset.length - index),
        // 횟수와 시각은 꾸며내지 않는다. 카드 순서를 정하는 것이 이 값들이라,
        // 프리셋 순서를 여기에 섞으면 "많이 본 것부터"가 거짓말이 된다.
        views: base?.views ?? 0,
        lastUsedAt: base?.lastUsedAt ?? null,
      } satisfies ScoreBreakdown;
    });
  }

  #inColdStart(): boolean {
    return isColdStart(
      this.#events.totalVisitCount(),
      this.#config.coldStart.visitsUntilPersonalized,
    );
  }

  /**
   * 지금 쓸 랭킹.
   *
   * <p>기록이 모자란 구간에서는 프리셋 순서를 쓴다 — 설치 이틀째의 오탭 하나가
   * 온보딩 카드를 밀어내지 않게 하려는 것이다(coldStart.ts 참고).
   * `liveReorder`를 켠 호스트는 그 보호를 포기하고 실제 기록을 바로 쓰겠다는 뜻이다.
   * 기록이 아직 전부 0점이면 도전자가 마진을 넘지 못해 어차피 화면은 그대로다.
   */
  #rankingNow(now: number): ScoreBreakdown[] {
    return this.#inColdStart() && !this.#config.stability.liveReorder
      ? this.#coldStartRanking(now)
      : this.#rank(now);
  }

  #applyForced(): void {
    const now = this.#clock();
    this.#layout = this.#stabilizer.recompute(this.#layout, this.#rankingNow(now), now, {
      force: true,
    }).state;
    this.#persist();
  }

  #snapshot(): PersistedState {
    const events = this.#events.snapshot();
    return {
      version: STATE_VERSION,
      visits: events.visits,
      aggregates: events.aggregates,
      pinned: [...this.#pinned],
      layout: this.#layout,
      profile: this.#profile,
      sessionCount: this.#sessionCount,
      learned: this.#learned.snapshot(),
    };
  }

  /**
   * 저장을 체인에 얹는다. 병렬 save가 서로를 덮어쓰지 않도록 순서를 강제한다.
   * 체인 자체는 절대 reject하지 않는다 — 아무도 await하지 않는 저장이 대부분이라
   * unhandled rejection이 되기 때문이다. 오류는 모아 두었다가 flush()에서 던진다.
   */
  #persist(): void {
    const state = this.#snapshot();
    this.#saveChain = this.#saveChain.then(async () => {
      try {
        await this.#storage.save(state);
      } catch (error) {
        this.#lastSaveError = error;
      }
    });
  }
}
