import { defineConfig } from "vitest/config";

// 패키지별 실행 환경이 다르다(core는 node, react는 jsdom).
// M3에서 react 프로젝트를 추가할 때 아래 배열에 한 항목만 더하면 된다.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          root: "./packages/core",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
