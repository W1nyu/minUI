/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** 도우미 중계기 주소. 없으면 도우미를 아예 안 만든다 (`shared/host-ai/assist.ts`). */
  readonly VITE_ASSIST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
