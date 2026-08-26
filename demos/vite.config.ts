import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { matchRoute } from "./src/matchRoute.js";
import { assistRoute } from "./src/assistRoute.js";
import { explainRoute } from "./src/explainRoute.js";
import { studioRoute } from "./src/studioRoute.js";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * 배포 기준 경로. 로컬은 `/`, GitHub Pages는 `/minUI/`다.
 *
 * <p>워크플로가 `MINUI_BASE`를 넣어 준다. 기본값을 `/`로 둔 이유는 **개발 경험을
 * 건드리지 않기 위해서**다 — `pnpm --filter demos dev`는 지금까지와 똑같이 돈다.
 * 이 값은 `import.meta.env.BASE_URL`로 흘러가고 `src/routePath.ts`가 그것을 읽는다.
 */
const BASE = process.env["MINUI_BASE"] ?? "/";


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
  // /api/assist·/api/explain — API 키를 브라우저로 내보내지 않기 위한 중계.
  plugins: [react(), assistRoute(),
    matchRoute(), explainRoute(), studioRoute()],
  resolve: {
    alias: [
      { find: "@minui/react/tokens.css", replacement: src("../packages/react/src/styles/tokens.css") },
      { find: "@minui/react/minui.css", replacement: src("../packages/react/src/styles/minui.css") },
      { find: "@minui/react", replacement: src("../packages/react/src/index.ts") },
      { find: "@minui/core", replacement: src("../packages/core/src/index.ts") },
      { find: "@minui/voice", replacement: src("../packages/voice/src/index.ts") },
    ],
  },
  server: { port: 5174 },
});
