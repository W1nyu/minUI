import { fileURLToPath } from "node:url";
import type { MenuCatalog } from "@minui/core";
import type { Connect, Plugin } from "vite";
import { harvest, siteNameFrom } from "../../services/harvester/src/harvest.js";
import { Gemini, readApiKey } from "../../services/enricher/src/gemini.js";
import { pickPresets, type Presets } from "../../services/enricher/src/presets.js";
import { buildMenus } from "../../tools/src/build-catalog.js";

/**
 * `/api/studio` — 링크 하나로 카탈로그를 만든다.
 *
 * <p>Studio의 전부가 여기 있다. 순서가 곧 이 프로젝트의 파이프라인이다.
 * <ol>
 *   <li><b>수집</b> — Playwright가 전체메뉴를 열고 계층을 읽는다 (로그인 불필요 4곳 회수율 99%)
 *   <li><b>조립</b> — `buildMenus`. 갈래·이름 겹침·개인정보 검사가 <b>CLI와 같은 함수</b>다.
 *       미리보기가 실제 산출물과 달라지면 미리보기가 거짓말이 된다
 *   <li><b>첫 화면</b> — LLM이 카드 넉 장을 고른다. 호출 한 번이다
 * </ol>
 *
 * <p>동의어 생성은 여기서 하지 않는다. 실측에서 색인에 넣으면 해로웠고(85% → 67%),
 * LLM은 런타임에 사용자가 한 말을 보고 고르는 쪽으로 옮겼다(`/api/assist`).
 * 뜻풀이는 있으면 좋지만 600개를 기다리게 할 수는 없어 CLI로 따로 돌린다.
 */

const KEY_FILE = fileURLToPath(new URL("../../api.txt", import.meta.url));
const MODEL = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";

/** 프리셋을 고를 때 모델에게 보여 줄 후보 수. 전부 보내면 토큰이 낭비된다. */
const PRESET_POOL = 120;

export interface StudioResult {
  site: string;
  host: string;
  catalog: MenuCatalog;
  presets: Presets;
  steps: { name: string; detail: string; ms: number }[];
  problems: string[];
  stats: {
    harvested: number;
    menus: number;
    branches: number;
    duplicateLabels: number;
    highRisk: number;
    codedIds: number;
  };
}

export function studioRoute(): Plugin {
  return {
    name: "minui-studio",
    configureServer(server) {
      const handler: Connect.NextHandleFunction = (request, response, next) => {
        if (request.url !== "/api/studio" || request.method !== "POST") {
          next();
          return;
        }

        const send = (status: number, body: unknown) => {
          response.statusCode = status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(body));
        };

        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          void (async () => {
            const steps: StudioResult["steps"] = [];
            const mark = (name: string, detail: string, from: number) =>
              steps.push({ name, detail, ms: Date.now() - from });

            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                url?: string;
              };
              if (!body.url) {
                send(400, { error: "주소를 넣어 주세요." });
                return;
              }

              // ① 수집
              let at = Date.now();
              const harvested = await harvest({ url: body.url, timeoutMs: 40_000 });
              mark("수집", `메뉴 후보 ${harvested.items.length}개`, at);

              // ② 조립 — CLI와 같은 함수, 같은 규칙
              at = Date.now();
              const site = siteNameFrom(harvested.source.host);
              const built = buildMenus(site, { source: harvested.source, items: harvested.items });
              mark("정리", `메뉴 ${built.menus.length}개`, at);

              // ③ 첫 화면
              at = Date.now();
              let presets: Presets = { inquiry: [], transfer: [], invest: [] };
              try {
                const gemini = new Gemini(readApiKey(KEY_FILE), { model: MODEL });
                const pool = built.menus
                  .filter((menu) => menu.cardable !== false)
                  .slice(0, PRESET_POOL)
                  .map((menu) => ({
                    menuId: menu.id,
                    label: menu.label,
                    ...(menu.path ? { path: menu.path } : {}),
                  }));
                presets = await pickPresets(gemini, pool);
                mark("첫 화면", "AI가 카드 넉 장을 골랐습니다", at);
              } catch {
                // 키가 없거나 모델이 죽어도 Studio는 돈다. 카탈로그 순서로 채운다.
                const fallback = built.menus
                  .filter((menu) => menu.cardable !== false)
                  .slice(0, 4)
                  .map((menu) => menu.id);
                presets = { inquiry: fallback, transfer: fallback, invest: fallback };
                mark("첫 화면", "AI 없이 카탈로그 순서로 채웠습니다", at);
              }

              const result: StudioResult = {
                site,
                host: harvested.source.host,
                catalog: built.menus,
                presets,
                steps,
                problems: built.problems,
                stats: {
                  harvested: harvested.items.length,
                  menus: built.menus.length,
                  branches: built.stats.branches,
                  duplicateLabels: built.stats.duplicateLabels,
                  highRisk: built.stats.highRisk,
                  codedIds: harvested.items.filter((item) => !item.key.startsWith("label:")).length,
                },
              };
              send(200, result);
            } catch (error) {
              const message = error instanceof Error ? error.message : "알 수 없는 오류";
              console.error("  [Studio 오류]", message);
              send(200, { error: message });
            }
          })();
        });
      };

      server.middlewares.use(handler);
    },
  };
}
