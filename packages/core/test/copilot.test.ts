import { describe, expect, it } from "vitest";
import { nextSteps, validateProposal, validateProposals } from "../src/copilot.js";
import type { MenuCatalog } from "../src/types.js";

/**
 * 코파일럿이 **넘을 수 없는 선**.
 *
 * <p>`진행할것.md`가 금지 넷을 적어 뒀다 — 없는 메뉴를 만들기, 위험도 낮추기,
 * 고위험 자동 실행, 계좌·금액 흘리기. 규칙으로 적어 두는 것과 통과할 수 없게 만드는
 * 것은 다르고, 여기서 재는 것은 후자다.
 *
 * <p>모델은 여기 없다. 모델이 무엇을 내놓든 이 함수를 지나야 화면에 닿으므로,
 * <b>모델 없이 모델의 최악을 재는 것</b>이 가능하다.
 */

const CATALOG: MenuCatalog = [
  {
    id: "inquiry.balance",
    label: "잔액 보기",
    synonyms: [],
    category: "조회",
    path: ["조회", "잔액·계좌"],
    icon: "wallet",
    route: "/inquiry/balance",
    riskLevel: "low",
  },
  {
    id: "inquiry.accounts",
    label: "내 계좌 모두 보기",
    synonyms: [],
    category: "조회",
    path: ["조회", "잔액·계좌"],
    icon: "wallet",
    route: "/inquiry/accounts",
    riskLevel: "medium",
  },
  {
    id: "transfer.account",
    label: "계좌 이체",
    synonyms: [],
    category: "이체",
    path: ["이체", "보내기"],
    icon: "transfer",
    route: "/transfer/account",
    riskLevel: "high",
  },
  {
    id: "transfer.recent",
    label: "최근 보낸 곳",
    synonyms: [],
    category: "이체",
    path: ["이체", "보내기"],
    icon: "person",
    route: "/transfer/recent",
    riskLevel: "high",
  },
];

const good = { menuId: "inquiry.balance", intent: "look", why: "통장에 남은 돈을 봅니다" };

describe("① 없는 메뉴를 만들 수 없다", () => {
  it("카탈로그에 없는 id는 버린다", () => {
    const result = validateProposal({ ...good, menuId: "transfer.crypto" }, CATALOG);
    expect(result).toEqual({ ok: false, reason: "unknown-menu" });
  });

  it("id가 문자열이 아니어도 버린다", () => {
    expect(validateProposal({ ...good, menuId: 7 }, CATALOG).ok).toBe(false);
    expect(validateProposal(null, CATALOG).ok).toBe(false);
    expect(validateProposal("계좌 이체", CATALOG).ok).toBe(false);
  });

  it("화면에 쓰는 이름은 카탈로그에서 온다 ★", () => {
    // 모델이 라벨을 함께 보내도 무시된다. 모델은 **어느 것인지만** 고른다.
    const result = validateProposal({ ...good, label: "무이자 특별대출" }, CATALOG);
    expect(result.ok && result.proposal.label).toBe("잔액 보기");
  });
});

describe("② 위험도를 낮출 수 없다", () => {
  it("모델이 low라고 해도 카탈로그가 high면 high다 ★", () => {
    const result = validateProposal(
      { menuId: "transfer.account", intent: "send", riskLevel: "low" },
      CATALOG,
    );
    expect(result.ok && result.proposal.riskLevel).toBe("high");
  });

  it("모델이 더 위험하다고 보면 그쪽을 따른다", () => {
    // 규칙 8은 한 방향만 막는다 — 내리지 못할 뿐 올리는 것은 허용한다.
    const result = validateProposal(
      { menuId: "inquiry.balance", intent: "look", riskLevel: "high" },
      CATALOG,
    );
    expect(result.ok && result.proposal.riskLevel).toBe("high");
  });

  it("위험도를 아예 안 보내면 카탈로그 값이다", () => {
    const result = validateProposal(good, CATALOG);
    expect(result.ok && result.proposal.riskLevel).toBe("low");
  });
});

describe("③ 고위험을 자동 실행할 수 없다", () => {
  it("high는 언제나 눌러야 열린다 ★", () => {
    const result = validateProposal({ menuId: "transfer.account", intent: "send" }, CATALOG);
    expect(result.ok && result.proposal.needsConfirm).toBe(true);
  });

  it("medium도 눌러야 열린다 — 돈은 안 나가지만 정보는 나간다", () => {
    const result = validateProposal({ menuId: "inquiry.accounts", intent: "look" }, CATALOG);
    expect(result.ok && result.proposal.needsConfirm).toBe(true);
  });

  it("모델이 needsConfirm을 거짓으로 보내도 소용없다 ★", () => {
    const result = validateProposal(
      { menuId: "transfer.account", intent: "send", needsConfirm: false },
      CATALOG,
    );
    // 이 값은 모델에게서 오지 않는다. riskLevel에서 계산된다.
    expect(result.ok && result.proposal.needsConfirm).toBe(true);
  });
});

describe("④ 계좌·금액을 흘릴 수 없다", () => {
  it("모델이 쓴 글에 숫자가 있으면 버린다 ★", () => {
    expect(
      validateProposal({ ...good, why: "1002-345-678901로 보냅니다" }, CATALOG),
    ).toEqual({ ok: false, reason: "why-has-digits" });
    expect(validateProposal({ ...good, why: "30000원을 보냅니다" }, CATALOG).ok).toBe(false);
    // 전각 숫자도 막는다.
    expect(validateProposal({ ...good, why: "３만원" }, CATALOG).ok).toBe(false);
  });

  it("한 줄을 넘으면 버린다", () => {
    const long = "가".repeat(61);
    expect(validateProposal({ ...good, why: long }, CATALOG)).toEqual({
      ok: false,
      reason: "why-too-long",
    });
  });

  it("숫자 없는 짧은 글은 남는다", () => {
    const result = validateProposal(good, CATALOG);
    expect(result.ok && result.proposal.why).toBe("통장에 남은 돈을 봅니다");
  });
});

describe("의도는 닫힌 집합이다", () => {
  it("모르는 의도는 버린다", () => {
    expect(validateProposal({ ...good, intent: "transfer_money_now" }, CATALOG)).toEqual({
      ok: false,
      reason: "unknown-intent",
    });
    expect(validateProposal({ menuId: "inquiry.balance" }, CATALOG).ok).toBe(false);
  });
});

describe("여럿을 한 번에", () => {
  it("나쁜 것만 빠지고 나머지는 남는다", () => {
    const kept = validateProposals(
      [good, { menuId: "없는메뉴", intent: "look" }, { menuId: "transfer.account", intent: "send" }],
      CATALOG,
    );
    expect(kept.map((p) => p.menuId)).toEqual(["inquiry.balance", "transfer.account"]);
  });

  it("같은 메뉴가 두 번 오면 한 번만 남는다", () => {
    expect(validateProposals([good, good], CATALOG)).toHaveLength(1);
  });

  it("배열이 아니면 빈 목록", () => {
    expect(validateProposals({ menuId: "inquiry.balance" }, CATALOG)).toEqual([]);
  });
});

describe("다음 단계 — 모델을 부르지 않는다", () => {
  it("같은 2단 갈래의 형제를 준다", () => {
    const steps = nextSteps({ catalog: CATALOG, menuId: "transfer.account" });
    expect(steps.map((s) => s.menuId)).toEqual(["transfer.recent"]);
  });

  it("자기 자신은 빼고, 위험도는 그대로 실린다", () => {
    const steps = nextSteps({ catalog: CATALOG, menuId: "inquiry.balance" });
    expect(steps.map((s) => s.menuId)).not.toContain("inquiry.balance");
    expect(steps[0]?.needsConfirm).toBe(true); // inquiry.accounts는 medium
  });

  it("형제가 없으면 아무것도 내지 않는다 ★", () => {
    const lonely: MenuCatalog = [{ ...CATALOG[0]!, path: ["조회", "혼자"] }];
    // 억지로 채우면 관계 없는 메뉴가 다음 단계인 척한다.
    expect(nextSteps({ catalog: lonely, menuId: "inquiry.balance" })).toEqual([]);
  });

  it("갈래가 한 단뿐이면 아무것도 내지 않는다", () => {
    const shallow: MenuCatalog = CATALOG.map((menu) => ({ ...menu, path: [menu.category] }));
    expect(nextSteps({ catalog: shallow, menuId: "transfer.account" })).toEqual([]);
  });

  it("같은 화면에서 늘 같은 것이 나온다 — 결정론", () => {
    const a = nextSteps({ catalog: CATALOG, menuId: "transfer.account" });
    const b = nextSteps({ catalog: CATALOG, menuId: "transfer.account" });
    expect(a).toEqual(b);
  });
});
