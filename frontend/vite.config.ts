import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * 배포 기준 경로. 미니은행은 데모 **아래**에 얹힌다 — 로컬은 `/`, Pages는 `/minUI/bank/`.
 *
 * <p>두 앱이 한 오리진에 있어야 데모에서 미니은행으로 그냥 링크로 건너갈 수 있고,
 * 나중에 백엔드를 붙일 때도 CORS가 필요 없다.
 */
const BASE = process.env["MINUI_BASE"] ? `${process.env["MINUI_BASE"]}bank/` : "/";


/**
 * 워크스페이스 패키지를 소스로 해석한다.
 *
 * 기본 해석은 package.json의 exports를 따라 `dist`로 가는데, 그러면 개발 중에
 * 엔진이나 컴포넌트를 고쳐도 데모 앱은 옛 빌드를 계속 쓴다. CSS만 소스에서 오고
 * 컴포넌트는 오지 않아 한참 헤맸다. 패키지 형태의 정합성은 `pnpm build`가 따로 본다.
 *
 * 배열 형태를 쓰는 이유: 별칭은 접두사 치환이라 "@minui/react"만 걸어 두면
 * "@minui/react/tokens.css"가 ".../src/index.ts/tokens.css"로 망가진다.
 * 더 구체적인 경로를 먼저 둔다.
 */
export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@minui/react/tokens.css", replacement: src("../packages/react/src/styles/tokens.css") },
      { find: "@minui/react/minui.css", replacement: src("../packages/react/src/styles/minui.css") },
      { find: "@minui/react", replacement: src("../packages/react/src/index.ts") },
      { find: "@minui/core", replacement: src("../packages/core/src/index.ts") },
      { find: "@minui/voice", replacement: src("../packages/voice/src/index.ts") },
    ],
  },
  server: { port: 5173 },
});
