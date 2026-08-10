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
const workspaceAliases = {
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
