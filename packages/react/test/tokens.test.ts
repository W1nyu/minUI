import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STYLES = join(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const tokensCss = readFileSync(join(STYLES, "tokens.css"), "utf8");
const minuiCss = readFileSync(join(STYLES, "minui.css"), "utf8");

/**
 * 접근성 수치를 토큰 파일에서 직접 읽어 계산한다.
 *
 * jsdom은 레이아웃도 CSS 변수 해석도 하지 않아 렌더된 DOM에서는 대비를 잴 수 없다.
 * 그래서 실제 색 값을 파싱해 WCAG 공식으로 검증한다 — 렌더링을 흉내 내는 것보다
 * 원본 숫자를 검사하는 쪽이 회귀를 확실히 잡는다.
 */

function tokensIn(blockPattern: RegExp): Record<string, string> {
  const block = tokensCss.match(blockPattern)?.[0] ?? "";
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/--minui-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    found[match[1]!] = match[2]!;
  }
  return found;
}

const light = tokensIn(/^:root\s*\{[\s\S]*?\n\}/m);
const dark = tokensIn(/^:root\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/m);

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/../g)!
    .map((pair) => {
      const value = Number.parseInt(pair, 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

/** 실제로 화면에 나타나는 전경/배경 조합만 검사한다. */
const TEXT_PAIRS: [fg: string, bg: string, label: string][] = [
  ["ink", "surface", "카드 제목"],
  ["ink", "paper", "본문"],
  ["ink", "surface-2", "눌린 카드"],
  ["ink-2", "surface", "카드 부가 설명"],
  ["ink-2", "paper", "인사말"],
  ["ink-3", "surface", "계좌번호·날짜"],
  ["ink-3", "paper", "카테고리 이름"],
  ["accent-ink", "accent", "주요 버튼 글자"],
  ["accent", "surface", "보조 버튼 글자"],
  ["accent", "accent-soft", "고정됨 표식"],
  ["warn", "warn-soft", "새로 왔어요 표식"],
  ["crit", "warn-soft", "오류 문구"],
];

describe.each([
  ["라이트", light],
  ["다크", dark],
])("%s 테마 명도 대비 (기획안 §11.3: 본문 4.5:1)", (_name, theme) => {
  it("토큰을 읽어냈다", () => {
    expect(Object.keys(theme).length).toBeGreaterThan(10);
  });

  it.each(TEXT_PAIRS)("%s / %s — %s", (fg, bg, _label) => {
    const ratio = contrast(theme[fg]!, theme[bg]!);
    expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("터치 타깃 (기획안 §11.3: 최소 88×88dp)", () => {
  it("88px 토큰이 정의돼 있다", () => {
    expect(tokensCss).toMatch(/--minui-touch-min:\s*88px/);
  });

  /**
   * jsdom은 레이아웃을 하지 않으므로 규칙 수준에서 검사한다.
   *
   * 처음에는 "토큰을 참조하는가"만 봤는데, 그 테스트는
   * `calc(var(--minui-touch-min) - 1.5rem)`도 통과시켰다. 실제 브라우저에서 재 보니
   * 글씨 크기 버튼이 48×64px이었다 — 테스트는 초록인데 요구는 깨져 있었다.
   * 그래서 지금은 **깎아 쓰는 것 자체를 금지**한다.
   */
  const TAPPABLE = [
    ".minui-card",
    ".minui-dock-button",
    ".minui-sheet-close",
    ".minui-menu-row",
    ".minui-menu-row-pin",
    // 보조 동작이라고 작게 두면 안 된다 — 작은 표적을 못 누르는 것이 이 사용자층의
    // 문제 그 자체다. 세로 길이를 쓰는 대가는 치른다.
    ".minui-menu-row-ask",
    ".minui-scale-button",
  ];

  it.each(TAPPABLE)("%s 가 최소 높이를 그대로 쓴다 (깎아 쓰지 않는다)", (selector) => {
    const rule = minuiCss.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`, "m"))?.[0];
    expect(rule, `${selector} 규칙을 찾지 못했습니다`).toBeDefined();

    const minHeight = rule!.match(/min-height:\s*([^;]+);/)?.[1];
    expect(minHeight, `${selector}에 min-height가 없습니다`).toBeDefined();

    // max(...)로 더 키우는 것은 허용, calc(...)로 빼는 것은 불허.
    expect(minHeight).toMatch(/var\(--minui-touch-min\)/);
    expect(minHeight, `${selector}가 최소 크기를 깎고 있습니다: ${minHeight}`).not.toMatch(
      /calc\([^)]*--minui-touch-min[^)]*[-+]/,
    );
  });

  it("카드와 글씨 크기 버튼은 가로도 최소 크기를 지킨다", () => {
    for (const selector of [".minui-card", ".minui-scale-button"]) {
      const rule = minuiCss.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`, "m"))?.[0] ?? "";
      expect(rule, selector).toMatch(/min-width:\s*var\(--minui-touch-min\)/);
    }
  });
});

describe("글씨 크기 3단계 (기획안 F5)", () => {
  it("세 단계가 모두 정의돼 있다", () => {
    expect(tokensCss).toMatch(/--minui-scale:\s*1;/);
    expect(tokensCss).toMatch(/\[data-minui-scale="large"\][\s\S]*?--minui-scale:\s*1\.2/);
    expect(tokensCss).toMatch(
      /\[data-minui-scale="xlarge"\][\s\S]*?--minui-scale:\s*1\.45/,
    );
  });

  it("글자 크기가 전부 배율에 묶여 있다 — 한 단계 조작으로 전체가 함께 커진다", () => {
    const textTokens = [...tokensCss.matchAll(/--minui-text-[\w-]+:\s*([^;]+);/g)];
    expect(textTokens.length).toBeGreaterThan(3);
    for (const [, value] of textTokens) {
      expect(value).toMatch(/var\(--minui-scale\)/);
    }
  });
});

describe("움직임 (기획안 §11.3: 애니메이션 최소화)", () => {
  it("애니메이션은 prefers-reduced-motion을 존중하는 블록 안에만 있다", () => {
    const withoutGuarded = minuiCss.replace(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/g,
      "",
    );
    expect(withoutGuarded).not.toMatch(/animation:\s*(?!none)/);
    expect(withoutGuarded).not.toMatch(/transition:\s*(?!none)/);
  });
});
