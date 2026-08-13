import { describe, expect, it } from "vitest";
import { checkUrl, parseRobots, robotsAllows } from "../src/guard.js";

/**
 * 안전 규칙은 "돌려 보니 되더라"로 검증할 수 없다. 뚫린 곳은 안 돌려 본 자리에 있다.
 */

describe("사설망 보호 (SSRF)", () => {
  it("금융사 주소는 통과한다", () => {
    expect(checkUrl("https://www.shinhan.com/index.jsp").ok).toBe(true);
    expect(checkUrl("www.kebhana.com").ok).toBe(true); // 스킴 없이 와도 https로 본다
  });

  it("클라우드 메타데이터 주소를 막는다", () => {
    // 이걸 놓치면 서버의 인스턴스 자격증명이 통째로 새어 나간다.
    const result = checkUrl("http://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("사설망");
  });

  it("루프백과 사설 대역을 막는다", () => {
    for (const url of [
      "http://127.0.0.1:5432",
      "http://10.0.0.5/admin",
      "http://192.168.0.1",
      "http://172.16.3.4",
      "http://[::1]/",
    ]) {
      expect(checkUrl(url).ok, url).toBe(false);
    }
  });

  it("이름으로 내부를 가리키는 것도 막는다", () => {
    expect(checkUrl("http://localhost:3000").ok).toBe(false);
    expect(checkUrl("http://db.internal/").ok).toBe(false);
  });

  it("http·https가 아닌 스킴은 열지 않는다", () => {
    expect(checkUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkUrl("ftp://example.com").ok).toBe(false);
  });

  it("공인 IP는 통과한다 — 사설만 막는다", () => {
    expect(checkUrl("http://8.8.8.8/").ok).toBe(true);
  });
});

describe("robots.txt", () => {
  const sample = `
    User-agent: BadBot
    Disallow: /

    User-agent: *
    Disallow: /admin
    Disallow: /private/
    Allow: /private/public
    Crawl-delay: 1
  `;

  it("우리에게 해당하는 블록만 읽는다", () => {
    const rules = parseRobots(sample);
    // BadBot 전용 "Disallow: /"를 우리 규칙으로 가져오면 안 된다.
    expect(rules.disallow).toEqual(["/admin", "/private/"]);
    expect(rules.allow).toEqual(["/private/public"]);
  });

  it("막힌 경로는 안 읽는다", () => {
    const rules = parseRobots(sample);
    expect(robotsAllows(rules, "/admin/users")).toBe(false);
    expect(robotsAllows(rules, "/private/secret")).toBe(false);
  });

  it("더 구체적인 Allow가 Disallow를 이긴다", () => {
    const rules = parseRobots(sample);
    expect(robotsAllows(rules, "/private/public/list")).toBe(true);
  });

  it("규칙에 없는 경로는 읽어도 된다", () => {
    expect(robotsAllows(parseRobots(sample), "/index.jsp")).toBe(true);
  });

  it("robots.txt가 비어 있으면 다 읽어도 된다", () => {
    expect(robotsAllows(parseRobots(""), "/quics")).toBe(true);
  });

  it("주석과 대소문자를 견딘다", () => {
    const rules = parseRobots("# 주석\nUSER-AGENT: *\nDISALLOW: /x  # 뒤 주석");
    expect(robotsAllows(rules, "/x/y")).toBe(false);
  });
});
