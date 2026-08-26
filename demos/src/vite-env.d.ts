/// <reference types="vite/client" />

/**
 * `import.meta.env`의 타입. `BASE_URL`은 vite/client가 이미 선언하고,
 * 여기서는 이 앱이 쓰는 것만 덧붙인다 (인터페이스 병합).
 */
interface ImportMetaEnv {
  readonly VITE_MINUI_NEURAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
