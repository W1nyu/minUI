import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PKG_ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * 주석은 스캔에서 뺀다. 이 규칙들을 *설명하는* 주석("Date.now()를 직접 부르지 않는다")이
 * 규칙 위반으로 잡히면, 규칙을 문서화할수록 테스트가 깨지는 우스운 상황이 된다.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(PKG_ROOT, path).replace(/\\/g, "/"),
  code: stripComments(readFileSync(path, "utf8")),
}));

/**
 * 이식성은 이 프로젝트의 존재 이유다 (AGENTS.md 규칙 1).
 * 기본은 의존성 0이지만, 제품 품질을 높이는 좁은 예외는 결정 근거와 함께 명시적으로
 * 선언할 수 있다. "없어야 한다"는 단정으로 발전을 막는 대신, 숨은 의존성만 막는다.
 */
describe("@minui/core 이식성", () => {
  it("런타임 의존성은 예외 근거 없이 들어오지 않는다", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      minui?: { portabilityExceptions?: Record<string, string> };
    };

    const runtime = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };
    const exceptions = pkg.minui?.portabilityExceptions ?? {};

    expect(Object.keys(runtime).sort()).toEqual(Object.keys(exceptions).sort());
    for (const reference of Object.values(exceptions)) {
      expect(reference).toMatch(/^docs\/.+\.md(?:#.+)?$/);
    }
  });

  it("소스 파일이 존재한다 (스캔이 빈 집합을 통과하지 않게)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("외부 모듈을 import 하지 않는다", () => {
    const offenders = files.flatMap(({ path, code }) =>
      [...code.matchAll(/from\s+["']([^"']+)["']/g)]
        .map((m) => m[1]!)
        .filter((spec) => !spec.startsWith("."))
        .map((spec) => `${path} → ${spec}`),
    );

    expect(offenders).toEqual([]);
  });

  it("브라우저·Node 전역에 손대지 않는다", () => {
    // 하나라도 들어오면 그 순간 코어는 특정 실행 환경에 묶인다.
    const forbidden = [
      "window",
      "document",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "navigator",
      "fetch(",
      "process.",
      "require(",
      "__dirname",
      "setTimeout",
      "setInterval",
    ];

    const offenders = files.flatMap(({ path, code }) =>
      forbidden
        .filter((token) => tokenPattern(token).test(code))
        .map((token) => `${path} → ${token}`),
    );

    expect(offenders).toEqual([]);
  });

  it("시각을 직접 읽지 않는다 — 항상 주입된 Clock을 쓴다", () => {
    // Date.now()가 코드에 박히면 테스트가 불가능해지고, 같은 입력이 다른 화면을 만든다.
    // 유일한 예외는 MinUIEngine의 기본 Clock이다.
    const offenders = files
      .filter(({ code }) => /new Date\(|Date\.now\(\)/.test(code))
      .map(({ path }) => path)
      .filter((path) => path !== "src/MinUIEngine.ts");

    expect(offenders).toEqual([]);
  });

  it("설정 기본값이 JSON으로 왕복 가능하다 — 다른 언어가 그대로 읽을 수 있어야 한다", async () => {
    const { DEFAULT_CONFIG } = await import("../src/config.js");
    expect(JSON.parse(JSON.stringify(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG);
  });
});

/**
 * 순수 단어 토큰은 양쪽 경계를 요구한다. 그러지 않으면 `documents()`라는
 * 우리 메서드 이름이 브라우저의 `document`로 잡힌다.
 * 이미 구두점을 포함한 토큰("process.", "fetch(")은 그 자체가 경계 역할을 한다.
 */
function tokenPattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^\w+$/.test(token) ? new RegExp(`\\b${escaped}\\b`) : new RegExp(`\\b${escaped}`);
}
