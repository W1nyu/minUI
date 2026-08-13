import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import {
  assist,
  type AssistCandidate,
} from "../../services/enricher/src/assist.js";
import { Gemini, readApiKey } from "../../services/enricher/src/gemini.js";

/**
 * 개발 서버에 붙이는 `/api/assist`.
 *
 * <p>**API 키가 브라우저로 가면 안 된다.** 클라이언트 코드에 넣으면 누구나 개발자 도구에서
 * 꺼내 쓸 수 있고, 그 순간 남의 한도로 남의 요금이 나간다. 그래서 키는 서버에만 두고
 * 브라우저는 이 경로로 묻는다.
 *
 * <p>배포할 때는 이 미들웨어가 서버리스 함수 하나로 바뀐다. 하는 일이 같아서
 * 옮기는 비용이 거의 없다 — 받은 질의와 후보를 모델에 넘기고 고른 id를 돌려주는 것뿐이다.
 *
 * <p>브라우저가 <b>후보를 함께 보낸다.</b> 서버가 카탈로그를 들고 있지 않아도 되고,
 * 무엇보다 사이트마다 다른 카탈로그를 서버가 알 필요가 없다 — 이식 계약이 좁게 유지된다.
 */

const KEY_FILE = fileURLToPath(new URL("../../api.txt", import.meta.url));
const MODEL = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";

interface AssistRequest {
  query: string;
  candidates: AssistCandidate[];
}

export function assistRoute(): Plugin {
  let gemini: Gemini | null = null;
  let unavailable: string | null = null;

  try {
    gemini = new Gemini(readApiKey(KEY_FILE), { model: MODEL });
  } catch (error) {
    // 키가 없어도 데모는 돈다. 도우미만 꺼진 채로 뜬다.
    unavailable = error instanceof Error ? error.message : "도우미를 쓸 수 없습니다.";
  }

  return {
    name: "minui-assist",
    configureServer(server) {
      if (unavailable) {
        console.log(`\n  [도우미 꺼짐] ${unavailable}\n`);
      }

      const handler: Connect.NextHandleFunction = (request, response, next) => {
        if (request.url !== "/api/assist" || request.method !== "POST") {
          next();
          return;
        }

        const send = (status: number, body: unknown) => {
          response.statusCode = status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(body));
        };

        if (!gemini) {
          // 왜 꺼졌는지는 서버 로그에만 남긴다. 파일 경로 같은 것이 브라우저로 나가면
          // 배포했을 때 서버 구조가 드러난다.
          send(503, { menuId: null, why: "도우미를 쓸 수 없습니다." });
          return;
        }

        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          void (async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AssistRequest;
              const picked = await assist(gemini!, body.query, body.candidates ?? []);
              send(200, picked);
            } catch (error) {
              // 도우미가 죽어도 화면은 되묻기로 돌아간다. 오류를 그대로 흘리지 않는다.
              console.error("  [도우미 오류]", error instanceof Error ? error.message : error);
              send(200, { menuId: null, why: "도우미가 답하지 못했습니다." });
            }
          })();
        });
      };

      server.middlewares.use(handler);
    },
  };
}

/** 배포 산출물에는 키가 없다는 것을 빌드 때 확인한다. */
export function assertNoKeyInBundle(bundlePath: string): void {
  const key = readApiKey(KEY_FILE);
  if (readFileSync(bundlePath, "utf8").includes(key)) {
    throw new Error("번들에 API 키가 들어갔습니다. 배포하면 안 됩니다.");
  }
}
