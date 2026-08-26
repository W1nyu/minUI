import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import { match, type MatchDeps } from "../../services/matcher/src/match.js";
import type { VectorIndex } from "../../services/matcher/src/vectors.js";
import { createEncoders } from "../../services/matcher/src/encoder.js";
import { ALL_SITES } from "./sites.js";

/**
 * 개발 서버에 붙이는 `/api/match` — 원격 신경망 검색 (M11).
 *
 * <p>`assistRoute.ts`와 같은 구조이고 같은 이유다 — <b>모델과 벡터가 브라우저로 가면
 * 안 된다.</b> 다만 여기서 지키는 것은 API 키가 아니라 크기다. 벡터 2.9MB와 모델
 * 600MB를 첫 화면에 얹으면 기획안 §8.3이 온디바이스 임베딩을 뺀 근거가 그대로 되살아난다.
 *
 * <h3>브라우저가 보내는 것</h3>
 * <b>질의 문자열과 사이트 id뿐이다.</b> 후보 목록도 라벨도 안 보낸다 — 서버가 벡터를
 * 들고 있으므로 필요가 없다. 돌아오는 것도 <b>메뉴 id와 점수뿐</b>이다.
 * (`/api/assist`는 발화와 후보 20개를 함께 보낸다. §11.1이 "메뉴 후보 id뿐"이라고
 * 적어 둔 것은 사실과 다르고 M11이 그 문장을 고친다.)
 *
 * <h3>없어도 돈다</h3>
 * 벡터를 안 구웠거나 모델이 없으면 이 라우트가 조용히 꺼진다. 화면은 로컬 검색으로
 * 지금까지와 <b>바이트 단위로 같게</b> 돈다 (불변 규칙 9).
 */

const VECTORS = new URL("./vectors/", import.meta.url);
const MODELS = fileURLToPath(new URL("../../tools/models", import.meta.url));

interface MatchRequest {
  query?: string;
  catalogId?: string;
}

interface SerializedIndex {
  version: 1;
  model: string;
  dim: number;
  menuIds: string[];
  scale: number[];
}

/** 구워 둔 벡터를 읽는다. 없는 사이트는 조용히 빠진다 — 원격은 없어도 되는 층이다. */
function loadIndexes(): Map<string, VectorIndex> {
  const indexes = new Map<string, VectorIndex>();

  /*
   * `catalogId`로 읽고 `slug`로 담는다. 파일은 수집 원본 이름을 쓰고(`kebhana.bin`)
   * 브라우저는 주소 이름을 보내기 때문이다(`/hana`). 대응은 `sites.ts` 한 곳에만 있다.
   *
   * `SITES`가 아니라 `ALL_SITES`를 도는 이유: 안 띄우는 두 곳도 주소를 직접 치면 열린다
   * (`App.tsx`의 `findSite`). 거기서만 원격이 빠지면 왜 그런지 알기 어렵다.
   */
  for (const site of ALL_SITES) {
    try {
      const meta = JSON.parse(
        readFileSync(new URL(`${site.catalogId}.json`, VECTORS), "utf8"),
      ) as SerializedIndex;
      const bin = readFileSync(new URL(`${site.catalogId}.bin`, VECTORS));

      indexes.set(site.slug, {
        version: 1,
        dim: meta.dim,
        menuIds: meta.menuIds,
        scale: Float32Array.from(meta.scale),
        data: new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength),
      });
    } catch {
      // 안 구운 사이트다. 그 사이트에서는 원격이 빠지고 로컬만 돈다.
    }
  }

  return indexes;
}

export function matchRoute(): Plugin {
  let deps: MatchDeps | null = null;
  let unavailable: string | null = null;
  let ready: Promise<void> = Promise.resolve();

  return {
    name: "minui-match",
    /*
     * **개발 서버에서만 붙는다.** 안 그러면 프로덕션 빌드가 모델 600MB를 불러온다 —
     * 실제로 그렇게 두고 빌드를 돌렸다가 멈췄다. 이 플러그인이 하는 일은 dev 서버에
     * 라우트를 다는 것뿐이라 빌드에서는 할 일이 애초에 없다.
     */
    apply: "serve",
    configureServer(server) {
      /*
       * 벡터와 인코더는 여기서 연다. 플러그인이 만들어질 때 열면 `apply`와 무관하게
       * 팩토리 호출만으로 모델이 뜬다.
       *
       * 인코더는 무겁다(600MB). 서버가 뜰 때 한 번만 만들고, 실패하면 라우트가 꺼진다.
       * 지연 로딩으로 미루지 않는 이유는 **첫 질의가 느려지면 그것이 곧 고장으로 읽히기**
       * 때문이다 — 고령 사용자에게 침묵은 고장이다.
       */
      const indexes = loadIndexes();
      ready = (async () => {
        if (indexes.size === 0) {
          unavailable = "구워 둔 벡터가 없습니다. pnpm --filter tools build:vectors";
          return;
        }
        try {
          const encoders = await createEncoders({ modelDir: MODELS });
          deps = { indexes, encoder: encoders.query };
        } catch (error) {
          unavailable = error instanceof Error ? error.message : "모델을 불러올 수 없습니다.";
        }
      })();

      void ready.then(() => {
        if (unavailable) {
          console.log(`\n  [원격 검색 꺼짐] ${unavailable}\n`);
        } else {
          console.log(`\n  [원격 검색] 사이트 ${indexes.size}곳의 벡터를 읽었습니다.\n`);
        }
      });

      const handler: Connect.NextHandleFunction = (request, response, next) => {
        if (request.url !== "/api/match" || request.method !== "POST") {
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
            await ready;
            if (!deps) {
              // 왜 꺼졌는지는 서버 로그에만 남긴다. 화면은 로컬 결과로 돌아간다.
              send(503, { matches: [] });
              return;
            }

            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as MatchRequest;
              const matches = await match(body.query ?? "", body.catalogId ?? "", deps, {
                topK: 20,
                /*
                 * 재순위는 아직 안 켠다. 교차 인코더는 top-20에 0.5~2초가 걸리고,
                 * 검색기만으로 사전 등록 게이트를 넘는지 먼저 본다 — 넘으면 그 지연을
                 * 치를 이유가 없다.
                 */
                rerankTopK: 0,
              });
              send(200, { matches });
            } catch (error) {
              console.error(
                "  [원격 검색 오류]",
                error instanceof Error ? error.message : error,
              );
              send(200, { matches: [] });
            }
          })();
        });
      };

      server.middlewares.use(handler);
    },
  };
}
