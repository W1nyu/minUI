/// <reference types="vite/client" />

/**
 * `import.meta.env`의 타입. `BASE_URL`은 vite/client가 이미 선언하고,
 * 여기서는 이 앱이 쓰는 것만 덧붙인다 (인터페이스 병합).
 */
interface ImportMetaEnv {
  readonly VITE_MINUI_NEURAL?: string;
  /** 도우미 중계기 주소. 없으면 도우미를 아예 안 만든다 (`shared/host-ai/assist.ts`). */
  readonly VITE_ASSIST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
