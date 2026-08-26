import { describe, expect, it } from "vitest";
import {
  AnswerCache,
  cacheKey,
  checkAssistRequest,
  clientKey,
  DailyBudget,
  MAX_CANDIDATES,
  MAX_QUERY_CHARS,
  RateLimiter,
} from "../src/guard.js";

/**
 * 중계기 앞의 문들. **Worker를 띄우지 않고 잰다.**
 *
 * <p>기획안 §14가 "공개 API 남용 | 시연 중 429로 기능 사망 | 미구현"으로 남겨 둔 자리다.
 * 여기서 막히는 것이 실제로 막히는지가 이 파일의 전부다 — 시연 중에 확인할 수는 없다.
 */

const candidate = (menuId: string, label = "계좌 이체") => ({ menuId, label });

describe("입력 상한 — 429보다 싼 문", () => {
  it("정상 요청은 통과한다", () => {
    const checked = checkAssistRequest({
      query: "돈 보내고 싶어",
      candidates: [candidate("transfer.account")],
    });
    expect(checked.ok).toBe(true);
  });

  it("질의가 상한을 넘으면 자르지 않고 거른다", () => {
    const checked = checkAssistRequest({
      query: "가".repeat(MAX_QUERY_CHARS + 1),
      candidates: [candidate("a")],
    });
    // 잘라서 받으면 사용자가 보낸 것과 모델이 본 것이 달라진다.
    expect(checked.ok).toBe(false);
  });

  it("후보 수를 서버에서도 강제한다", () => {
    const many = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => candidate(`m${i}`));
    expect(checkAssistRequest({ query: "이체", candidates: many }).ok).toBe(false);
  });

  it("빈 질의와 빈 후보를 거른다", () => {
    expect(checkAssistRequest({ query: "   ", candidates: [] }).ok).toBe(false);
    expect(checkAssistRequest({ query: "이체" }).ok).toBe(false);
  });

  it("menuId가 없는 후보를 거른다 — 모델이 지어낼 자리를 막는다", () => {
    expect(checkAssistRequest({ query: "이체", candidates: [{ label: "계좌 이체" }] }).ok).toBe(
      false,
    );
  });

  it("경로가 너무 깊으면 거른다", () => {
    const deep = { menuId: "a", label: "b", path: ["1", "2", "3", "4", "5", "6", "7"] };
    expect(checkAssistRequest({ query: "이체", candidates: [deep] }).ok).toBe(false);
  });
});

describe("캐시 — 한도를 태우지 않는 문", () => {
  it("같은 질의와 같은 후보면 같은 키다", () => {
    const a = { query: "돈 보내줘", candidates: [candidate("x"), candidate("y")] };
    const b = { query: " 돈  보내줘 ", candidates: [candidate("y"), candidate("x")] };
    // 공백과 후보 순서는 답을 바꾸지 않는다. 엔진이 순서를 조금 바꿔도 재활용한다.
    expect(cacheKey(a)).toBe(cacheKey(b));
  });

  it("후보가 다르면 다른 키다 — 사이트가 다르면 답도 다르다", () => {
    const a = { query: "이체", candidates: [candidate("shinhan.x")] };
    const b = { query: "이체", candidates: [candidate("kbsec.x")] };
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("답이 null인 것도 담는다 ★", () => {
    const cache = new AnswerCache();
    cache.set("날씨", null);
    // 이게 없으면 "날씨 어때" 같은 말이 반복될 때마다 한도를 태운다.
    expect(cache.get("날씨")).toEqual({ menuId: null, at: expect.any(Number) });
  });

  it("오래된 것은 없는 것으로 본다", () => {
    const cache = new AnswerCache(10, 1_000);
    cache.set("a", "menu.a", 0);
    expect(cache.get("a", 500)).toBeDefined();
    expect(cache.get("a", 2_000)).toBeUndefined();
  });

  it("상한을 넘으면 오래 안 쓴 것부터 버린다", () => {
    const cache = new AnswerCache(2);
    cache.set("1", "a");
    cache.set("2", "b");
    cache.get("1"); // 1을 최근으로 올린다
    cache.set("3", "c");
    expect(cache.size).toBe(2);
    expect(cache.get("2")).toBeUndefined();
    expect(cache.get("1")).toBeDefined();
  });
});

describe("호출 제한", () => {
  it("분당 상한을 넘으면 막는다", () => {
    const limiter = new RateLimiter({ perMinute: 3, perHour: 100 });
    for (let i = 0; i < 3; i += 1) expect(limiter.check("1.2.3.4", 0)).toBeNull();
    expect(limiter.check("1.2.3.4", 0)).not.toBeNull();
  });

  it("창이 지나면 다시 열린다", () => {
    const limiter = new RateLimiter({ perMinute: 1, perHour: 100 });
    expect(limiter.check("1.2.3.4", 0)).toBeNull();
    expect(limiter.check("1.2.3.4", 0)).not.toBeNull();
    expect(limiter.check("1.2.3.4", 61_000)).toBeNull();
  });

  it("사람마다 따로 센다", () => {
    const limiter = new RateLimiter({ perMinute: 1, perHour: 100 });
    expect(limiter.check("1.1.1.1", 0)).toBeNull();
    expect(limiter.check("2.2.2.2", 0)).toBeNull();
  });

  it("Cloudflare가 넣어 주는 것을 먼저 본다", () => {
    const headers = new Headers({
      "cf-connecting-ip": "9.9.9.9",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });
    expect(clientKey(headers)).toBe("9.9.9.9");
    expect(clientKey(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("하루 예산", () => {
  it("다 쓰면 더 안 준다", () => {
    const budget = new DailyBudget(2);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    expect(budget.left).toBe(0);
  });

  it("날이 바뀌면 처음부터", () => {
    const budget = new DailyBudget(1);
    expect(budget.take(new Date("2026-08-26T23:59:00Z"))).toBe(true);
    expect(budget.take(new Date("2026-08-26T23:59:30Z"))).toBe(false);
    expect(budget.take(new Date("2026-08-27T00:00:01Z"))).toBe(true);
  });
});
