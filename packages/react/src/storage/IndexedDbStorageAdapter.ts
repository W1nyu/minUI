import type { PersistedState, StorageAdapter } from "@minui/core";

const DB_NAME = "minui";
const STORE = "state";
const DB_VERSION = 1;

/**
 * 웹용 기본 저장소.
 *
 * 이 파일이 `@minui/core`가 아니라 여기 있는 것이 핵심이다. 코어가 IndexedDB를 알면
 * React Native·키오스크·서버 어디에도 못 올라간다. 브라우저 의존은 어댑터 한 겹에만 둔다.
 *
 * IndexedDB를 쓸 수 없는 환경(사생활 보호 모드, 용량 거부 등)에서는 조용히
 * 세션 메모리로 내려간다. 개인화가 안 되는 것은 불편이지만, 앱이 뜨지 않는 것은 장애다.
 */
export class IndexedDbStorageAdapter implements StorageAdapter {
  readonly #key: string;
  #memoryFallback: PersistedState | null = null;
  #unavailable = false;

  constructor(key = "default") {
    this.#key = key;
  }

  async load(): Promise<PersistedState | null> {
    try {
      const db = await this.#openDb();
      return await new Promise<PersistedState | null>((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(this.#key);
        request.onsuccess = () => resolve((request.result as PersistedState) ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      this.#unavailable = true;
      return this.#memoryFallback;
    }
  }

  async save(state: PersistedState): Promise<void> {
    this.#memoryFallback = state;
    if (this.#unavailable) return;

    try {
      const db = await this.#openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(state, this.#key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      this.#unavailable = true;
    }
  }

  /** 저장소를 쓸 수 없어 세션 메모리로 동작 중인가. 호스트가 안내할 수 있게 노출한다. */
  get isEphemeral(): boolean {
    return this.#unavailable;
  }

  #openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB를 쓸 수 없는 환경입니다."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB가 다른 탭에 의해 잠겼습니다."));
    });
  }
}
