import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import { clarify } from "../../services/enricher/src/clarify.js";
import { confirmSentence } from "../../services/enricher/src/confirm.js";
import { correctQuery } from "../../services/enricher/src/correct.js";
import { safetyTips } from "../../services/enricher/src/safetyTips.js";
import {
  OpenAiCompatible,
  readOpenAiCompatibleConfig,
} from "../../services/enricher/src/openaiCompatible.js";
import { Gemini, readApiKey } from "../../services/enricher/src/gemini.js";
import { FallbackLlm, type LlmClient } from "../../services/enricher/src/llm.js";

/**
 * 개발 서버에 붙이는 `/api/clarify` · `/api/confirm` · `/api/safety` · `/api/correct`
 * (AI-2 · AI-3 · AI-4 · AI-5 · AI-6).
 *
 * <p>`assistRoute.ts`·`explainRoute.ts`와 같은 이유로 서버에 둔다 — **API 키가 브라우저로
 * 가면 안 된다.** 배포에서는 이 둘이 `services/assist-worker`의 같은 경로가 된다.
 * 하는 일이 같아서 옮기는 비용이 거의 없다.
 *
 * <p><b>한도 두 개를 잇는다</b> (AI-1). Gemini가 먼저이고, 한도나 장애로 막히면
 * OpenAI 호환 공급자가 받는다. **벤더를 고르지 않는다** — 주소·키·모델 셋을 주면
 * 그곳이 두 번째가 되고, 셋 중 하나라도 없으면 Gemini 하나로만 돌면서 체인은 그대로
 * 작동한다. 없는 것을 예외로 다루지 않는다.
 *
 * <p>둘 다 없으면 이 경로가 503을 준다. 브라우저는 그것을 `null`로 접고, 화면은
 * 지금까지의 되묻기와 고정 문구를 쓴다.
 */

const KEY_FILE = fileURLToPath(new URL("../../api.txt", import.meta.url));

/**
 * 공급자 체인을 만든다. **키가 하나도 없으면 `null`** — 그때는 도우미가 없는 것이다.
 *
 * <p>여기서 만든 체인 하나를 네 경로가 공유한다. 경로마다 새로 만들면 `Gemini`가
 * 429를 보고 스스로 늘린 간격이 경로마다 따로 놀아, 한 곳이 한도를 배우는 동안
 * 다른 곳이 계속 두드린다.
 */
export function makeLlmChain(onNote: (message: string) => void): LlmClient | null {
  const clients: LlmClient[] = [];

  try {
    clients.push(new Gemini(readApiKey(KEY_FILE), {
      model: process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite",
      onNote,
    }));
  } catch {
    // 키가 없어도 데모는 돈다. 이유는 assistRoute가 이미 콘솔에 적는다.
  }

  const compat = readOpenAiCompatibleConfig();
  if (compat) {
    clients.push(
      new OpenAiCompatible(compat.apiKey, {
        baseUrl: compat.baseUrl,
        model: compat.model,
        onNote,
      }),
    );
  }

  if (clients.length === 0) return null;
  return clients.length === 1 ? clients[0]! : new FallbackLlm(clients, onNote);
}

/** 이 플러그인이 여는 경로. 배포에서는 중계기의 같은 이름이 받는다. */
const ROUTES = ["clarify", "confirm", "safety", "correct"] as const;

type AiRoute = (typeof ROUTES)[number];

const EMPTY: Record<AiRoute, Record<string, unknown>> = {
  clarify: { clarification: null },
  confirm: { template: null },
  safety: { tips: [] },
  correct: { corrected: null },
};

export function aiRoutes(): Plugin {
  const note = (message: string) => console.log(`  [AI] ${message}`);
  const llm = makeLlmChain(note);

  return {
    name: "minui-ai-routes",
    configureServer(server) {
      if (!llm) console.log("\n  [되묻기·확인 문장·점검 풀이·음성 교정 꺼짐] 키가 없습니다.\n");

      const handler: Connect.NextHandleFunction = (request, response, next) => {
        const path = request.url ?? "";
        const route = ROUTES.find((name) => path === `/api/${name}`);
        if (!route || request.method !== "POST") {
          next();
          return;
        }

        const send = (status: number, body: unknown) => {
          response.statusCode = status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(body));
        };

        // 경로마다 화면이 기대하는 **빈 모양**이 다르다. 없을 때도 모양은 지켜야 한다.
        const empty = EMPTY[route];
        if (!llm) {
          send(503, empty);
          return;
        }

        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          void (async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
                string,
                unknown
              >;

              if (route === "clarify") {
                const query = typeof body["query"] === "string" ? body["query"] : "";
                const branches = Array.isArray(body["branches"])
                  ? (body["branches"] as { label: string }[])
                  : [];
                const clarification = await clarify(llm, query, branches);
                send(200, { clarification, model: llm.name });
                return;
              }

              if (route === "safety") {
                const kinds = Array.isArray(body["kinds"]) ? (body["kinds"] as string[]) : [];
                send(200, { tips: await safetyTips(llm, kinds), model: llm.name });
                return;
              }

              if (route === "correct") {
                const heard = typeof body["heard"] === "string" ? body["heard"] : "";
                const candidates = Array.isArray(body["candidates"])
                  ? (body["candidates"] as { label: string }[])
                  : [];
                send(200, {
                  corrected: await correctQuery(llm, heard, candidates),
                  model: llm.name,
                });
                return;
              }

              const riskLevel = body["riskLevel"];
              const template = await confirmSentence(llm, {
                riskLevel:
                  riskLevel === "low" || riskLevel === "medium" || riskLevel === "high"
                    ? riskLevel
                    : "high",
                ...(Array.isArray(body["concerns"])
                  ? { concerns: body["concerns"] as string[] }
                  : {}),
              });
              send(200, { template, model: llm.name });
            } catch (error) {
              /*
               * 죽어도 200에 빈 답으로 준다. 화면에는 이미 되묻기와 고정 문구가 있고,
               * 여기서 상태를 하나 더 만들면 화면의 계약이 셋으로 늘어난다.
               */
              console.error("  [AI 오류]", error instanceof Error ? error.message : error);
              send(200, empty);
            }
          })();
        });
      };

      server.middlewares.use(handler);
    },
  };
}
