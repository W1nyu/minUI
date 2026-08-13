import type { ColdStartPresets, MenuCatalog } from "@minui/core";
import type { Connect, Plugin } from "vite";
import { harvest, siteNameFrom } from "../../services/harvester/src/harvest.js";
import { buildMenus } from "../../tools/src/build-catalog.js";
import { firstCards } from "../../tools/src/presets.js";

/**
 * `/api/studio` — 링크 하나로 카탈로그를 만든다.
 *
 * <p>Studio의 전부가 여기 있다. 순서가 곧 이 프로젝트의 파이프라인이다.
 * <ol>
 *   <li><b>수집</b> — Playwright가 전체메뉴를 열고 계층을 읽는다 (로그인 불필요 4곳 회수율 99%)
 *   <li><b>조립</b> — `buildMenus`. 갈래·이름 겹침·개인정보 검사가 <b>CLI와 같은 함수</b>다.
 *       미리보기가 실제 산출물과 달라지면 미리보기가 거짓말이 된다
 *   <li><b>첫 화면</b> — 카탈로그 앞 넉 장 (`firstCards`)
 * </ol>
 *
 * <p><b>이 경로에는 LLM이 없다.</b> 셋 다 결정론이라 같은 주소를 넣으면 같은 결과가 나오고,
 * 키가 없어도 완전히 같은 것이 나온다. 동의어 생성은 색인에 넣으면 해로웠고(85% → 67%),
 * 뜻풀이는 600개를 기다리게 할 수 없어 CLI로 따로 돌린다. 첫 화면 고르기도 물어봤었는데
 * 품질이 그저 그런 데다 며칠이면 사용 기록에 밀려 사라지는 배치라 그만뒀다
 * (`tools/src/presets.ts`).
 *
 * <p>LLM은 <b>사용자가 무언가를 물었을 때만</b> 부른다 — `/api/assist`(못 찾은 검색)와
 * `/api/explain`(어려운 말 풀이). 메뉴를 만드는 데는 쓰이지 않는다.
 */

export interface StudioResult {
  site: string;
  host: string;
  catalog: MenuCatalog;
  presets: ColdStartPresets;
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

              // ③ 첫 화면 — 카탈로그 앞 넉 장. 짐작하지 않는다.
              at = Date.now();
              const presets = firstCards(built.menus);
              mark("첫 화면", "카탈로그 앞 넉 장으로 시작합니다", at);

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
