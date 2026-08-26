import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * 워크스페이스 패키지는 소스로 해석한다.
 *
 * 기본 해석은 `dist`를 가리키므로, 코어를 고치고 빌드를 잊으면 UI 테스트가
 * 옛 코어를 검사하게 된다. 실제로 그 함정에 한 번 빠져 고정(핀) 버그를 놓칠 뻔했다.
 * 빌드 산출물의 정합성은 `pnpm build`와 typecheck가 따로 책임진다.
 */
/*
 * 별칭은 접두사 치환이라 **더 구체적인 경로를 먼저 둔다.** 지금은 여기 서브패스가
 * 하나도 없지만(`@minui/voice/whisper`는 M11에서 사라졌다) 규칙은 남겨 둔다 —
 * `demos/vite.config.ts`가 CSS 서브패스에서 같은 함정에 빠진 적이 있다.
 */
const workspaceAliases = {
  // 두 호스트 앱이 나눠 쓰는 AI 클라이언트. 앱의 vite.config에도 같은 별칭이 있다 —
  // 테스트는 그 파일들을 안 읽으므로 여기에도 두어야 한다.
  "@host-ai": resolve("./shared/host-ai"),
  "@minui/core": resolve("./packages/core/src/index.ts"),
  "@minui/react": resolve("./packages/react/src/index.ts"),
  "@minui/voice": resolve("./packages/voice/src/index.ts"),
};

export default defineConfig({
  test: {
    projects: [
      {
        // core가 node 환경에서 도는 것 자체가 이식성의 증거다.
        test: {
          name: "core",
          root: "./packages/core",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "voice",
          root: "./packages/voice",
          // jsdom을 쓰지 않는다. Web Speech API는 jsdom에도 없으므로,
          // "지원하지 않는 환경"의 동작을 검증하는 데는 node가 더 정직하다.
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: workspaceAliases },
        test: {
          name: "react",
          root: "./packages/react",
          environment: "jsdom",
          include: ["test/**/*.test.{ts,tsx}"],
          setupFiles: ["./test/setup.ts"],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "tools",
          root: "./tools",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          /*
           * 모델은 여기서 안 돈다. onnx가 붙은 부분(인코더·재순위)은 가중치 수백 MB가
           * 있어야 돌아서 CI에서 영영 안 돌기 때문이다 — 안 도는 테스트는 없는 테스트다.
           * 대신 **인코더가 낸 숫자를 다루는 부분**을 잰다. 검색 품질의 절반이 거기 있다.
           */
          name: "matcher",
          root: "./services/matcher",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          // 수집기의 DOM 순회는 브라우저 안에서만 돌지만, 링크에서 id를 뽑는 판단은
          // 순수 함수라 여기서 잰다. 그 판단이 수집기 품질을 거의 전부 결정한다.
          name: "harvester",
          root: "./services/harvester",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          // LLM 호출은 네트워크라 여기서 안 돈다. 대신 **응답을 검증하는 부분**을 잰다 —
          // 모델이 없는 메뉴를 지어내거나 위험도를 낮추는 것을 못 막으면 그대로 화면까지 간다.
          name: "enricher",
          root: "./services/enricher",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: workspaceAliases },
        test: {
          name: "frontend",
          root: "./frontend",
          environment: "jsdom",
          include: ["test/**/*.test.{ts,tsx}"],
          setupFiles: ["./test/setup.ts"],
        },
      },
    ],
  },
});
