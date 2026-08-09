import type { PersistedState, StorageAdapter } from "../types.js";

/**
 * 기본 저장소. 세션 안에서만 유지된다.
 *
 * core가 IndexedDB나 파일 시스템을 알면 안 되므로(AGENTS.md 불변 규칙 1),
 * 영속 저장은 전부 호스트가 주입하는 어댑터의 몫이다.
 * 웹용 IndexedDB 어댑터는 `@minui/react`에 있다.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  #state: PersistedState | null;

  constructor(initial: PersistedState | null = null) {
    this.#state = initial ? clone(initial) : null;
  }

  async load(): Promise<PersistedState | null> {
    return this.#state ? clone(this.#state) : null;
  }

  async save(state: PersistedState): Promise<void> {
    this.#state = clone(state);
  }
}

/**
 * 저장은 값 복사여야 한다. 참조를 그대로 들고 있으면 엔진의 내부 변경이
 * 저장소에 새어 들어가, "다음 세션에 반영"이라는 지연 커밋 규칙이 조용히 깨진다.
 *
 * 동시에 이 복사는 상태가 JSON 왕복 가능한지를 매 저장마다 검증하는 역할도 한다.
 */
function clone(state: PersistedState): PersistedState {
  return JSON.parse(JSON.stringify(state)) as PersistedState;
}
