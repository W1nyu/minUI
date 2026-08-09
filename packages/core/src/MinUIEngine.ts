import { EventStore } from "./EventStore.js";
import { LayoutStabilizer } from "./LayoutStabilizer.js";
import { RankingEngine } from "./RankingEngine.js";
import { DEFAULT_PROFILE, coldStartCards, isColdStart } from "./coldStart.js";
import { type MinUIConfig, type PartialConfig, resolveConfig } from "./config.js";
import { MenuIndex } from "./search/MenuIndex.js";
import { NgramTfIdfProvider } from "./search/NgramTfIdfProvider.js";
import { SearchPipeline, type SearchOutcome } from "./search/SearchPipeline.js";
import { resolveVoiceAction, type VoiceAction } from "./search/voiceAction.js";
import type { EmbeddingProvider } from "./search/EmbeddingProvider.js";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter.js";
import type {
  ActionHandler,
  Clock,
  ColdStartPresets,
  ColdStartProfile,
  LayoutState,
  MenuCatalog,
  MenuId,
  MenuItem,
  PersistedState,
  RankedCard,
  ScoreBreakdown,
  StorageAdapter,
  UsageEvent,
} from "./types.js";

const STATE_VERSION = 1;

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

  readonly #events: EventStore;
  readonly #ranking: RankingEngine;
  readonly #stabilizer: LayoutStabilizer;
  readonly #search: SearchPipeline;

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

    this.#events = new EventStore(
      this.#config,
      restored ? { visits: restored.visits, aggregates: restored.aggregates } : undefined,
    );
    this.#ranking = new RankingEngine(this.#config, this.#events);
    this.#stabilizer = new LayoutStabilizer(this.#config);

    const index = new MenuIndex(options.catalog);
    this.#search = new SearchPipeline(
      index,
      this.#config,
      options.embedding ?? NgramTfIdfProvider.build(index.documents()),
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

    if (this.#layout.current.length === 0) {
      // 최초 실행: 온보딩 프로파일로 첫 화면을 만든다.
      this.#layout = this.#stabilizer.recompute(
        this.#layout,
        this.#coldStartRanking(now),
        now,
      ).state;
    } else if (!this.#inColdStart()) {
      this.#layout = this.#stabilizer.recompute(this.#layout, this.#rank(now), now).state;
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
    this.#onAction(menuId, params);
  }

  /** 호스트가 "이 화면에서 할 일을 끝냈다"고 알리는 지점. */
  complete(menuId: MenuId): void {
    this.recordEvent({ type: "task_complete", menuId });
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
   * 검색 결과를 화면 동작으로 바꾼다. 기획안 §9.3의 안전 경계가 여기서 적용된다 —
   * `riskLevel: "high"` 메뉴는 어떤 확신 수준에서도 자동으로 열리지 않는다.
   *
   * @param sttConfidence 음성 인식 신뢰도. 텍스트 검색이면 생략한다.
   */
  voiceAction(query: string, sttConfidence?: number): VoiceAction {
    return resolveVoiceAction({
      outcome: this.search(query),
      menus: this.#byId,
      config: this.#config,
      ...(sttConfidence !== undefined ? { sttConfidence } : {}),
    });
  }

  recordEvent(event: UsageEvent): void {
    this.#events.record(event, this.#clock());
    this.#persist();
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

  // ── 진단용 ──────────────────────────────────────────────────────────────

  /** 어떤 카드가 왜 그 자리에 있는지. 측정(M5)과 디버깅에 쓴다. */
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
      } satisfies ScoreBreakdown;
    });
  }

  #inColdStart(): boolean {
    return isColdStart(
      this.#events.totalVisitCount(),
      this.#config.coldStart.visitsUntilPersonalized,
    );
  }

  #applyForced(): void {
    const now = this.#clock();
    const ranked = this.#inColdStart() ? this.#coldStartRanking(now) : this.#rank(now);
    this.#layout = this.#stabilizer.recompute(this.#layout, ranked, now, {
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
