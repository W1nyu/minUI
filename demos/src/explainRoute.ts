import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import { explain, type ExplainTarget } from "../../services/enricher/src/explain.js";
import { Gemini, readApiKey } from "../../services/enricher/src/gemini.js";

/**
 * 개발 서버에 붙이는 `/api/explain`.
 *
 * <p>`assistRoute.ts`와 같은 이유로 서버에 둔다 — **API 키가 브라우저로 가면 안 된다.**
 * 하는 일도 같은 모양이다: 브라우저가 <b>메뉴 이름과 경로만</b> 보내고 서버가 모델에 묻는다.
 * 서버는 사이트별 카탈로그를 들고 있지 않아도 된다.
 *
 * <p>보내는 것이 무엇인지가 중요하다. 메뉴 <b>이름</b>이지 사용자에 대한 것이 아니다 —
 * 누가 무엇을 눌렀는지는 기기 밖으로 나가지 않는다 (기획안 §11.1).
 */

const KEY_FILE = fileURLToPath(new URL("../../api.txt", import.meta.url));
const MODEL = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";

export function explainRoute(): Plugin {
  let gemini: Gemini | null = null;

  try {
    gemini = new Gemini(readApiKey(KEY_FILE), { model: MODEL });
  } catch {
    // 키가 없어도 데모는 돈다. 묻는 버튼이 답을 못 줄 뿐이다.
    // 왜 꺼졌는지는 assistRoute가 이미 콘솔에 적는다.
  }

  return {
    name: "minui-explain",
    configureServer(server) {
      const handler: Connect.NextHandleFunction = (request, response, next) => {
        if (request.url !== "/api/explain" || request.method !== "POST") {
          next();
          return;
        }

        const send = (status: number, body: unknown) => {
          response.statusCode = status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(body));
        };

        if (!gemini) {
          send(503, { hint: null });
          return;
        }

        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          void (async () => {
            try {
              const body = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as ExplainTarget;
              if (!body.label) {
                send(400, { hint: null });
                return;
              }
              send(200, { hint: await explain(gemini!, body) });
            } catch (error) {
              // 모른다고 답하는 것이 틀린 뜻풀이보다 낫다.
              console.error(
                "  [뜻풀이 오류]",
                error instanceof Error ? error.message : error,
              );
              send(200, { hint: null });
            }
          })();
        });
      };

      server.middlewares.use(handler);
    },
  };
}
