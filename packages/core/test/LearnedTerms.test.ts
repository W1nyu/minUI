import { describe, expect, it } from "vitest";
import { DAY_MS, DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import { LearnedTerms, isLearnable } from "../src/search/LearnedTerms.js";

/**
 * 개인 동의어 학습 (M7).
 *
 * <p>검색이 놓친 표현으로 사용자가 결국 메뉴에 도달했다면, 그 표현은 <b>그 사람에게</b>
 * 그 메뉴의 이름이다. 다음부터는 한 번에 찾게 한다.
 *
 * <p>이 파일이 지키는 것은 세 가지다.
 * <ol>
 *   <li>배울 것과 배우지 말 것의 경계 — 개인정보와 우연을 들이지 않는다
 *   <li>잘못 배운 것이 영원하지 않을 것 — 잊고, 지울 수 있다
 *   <li>학습이 확실한 근거를 밀어내지 않을 것 — 라벨 정확 매칭이 언제나 위다
 * </ol>
 */

const CONFIG = DEFAULT_CONFIG;
const T0 = 1_700_000_000_000;

/** 검색이 그 메뉴를 이미 1위로 냈는가. 학습 여부를 가르는 값이라 테스트에서 명시한다. */
const MISSED = false;
const FOUND = true;

function learner(overrides?: Parameters<typeof resolveConfig>[0]) {
  return new LearnedTerms(overrides ? resolveConfig(overrides) : CONFIG);
}

describe("무엇을 배우는가", () => {
  it("검색이 놓친 표현과 사용자가 연 메뉴를 잇는다", () => {
    const learned = learner();

    expect(
      learned.learn({ query: "돈 부쳐야 하는데", menuId: "transfer", foundAlready: MISSED, now: T0 }),
    ).toBe(true);

    expect(learned.match("돈부쳐")).toEqual([
      { menuId: "transfer", term: "돈부쳐", score: CONFIG.learning.baseScore },
    ]);
  });

  /*
   * 이미 1위로 나오던 것을 또 배우면 색인만 부푼다. `docs/기획안.md` §16이 기록한
   * 실측이 정확히 이 방향을 경고한다 — 동의어를 전 메뉴에 얹었더니 85%가 67%로 떨어졌다.
   * 서로 방해하기 때문이다. **못 찾았을 때만 배운다.**
   */
  it("이미 1위로 찾던 표현은 배우지 않는다", () => {
    const learned = learner();

    expect(
      learned.learn({ query: "계좌이체", menuId: "transfer", foundAlready: FOUND, now: T0 }),
    ).toBe(false);
    expect(learned.size).toBe(0);
  });

  it("같은 짝을 다시 보면 횟수가 오르고 점수도 오른다", () => {
    const learned = learner();
    const say = (now: number) =>
      learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now });

    say(T0);
    say(T0 + DAY_MS);

    expect(learned.snapshot()).toEqual([
      { term: "돈부쳐", menuId: "transfer", count: 2, lastAt: T0 + DAY_MS },
    ]);
    expect(learned.match("돈부쳐")[0]!.score).toBeCloseTo(
      CONFIG.learning.baseScore + CONFIG.learning.scoreStep,
    );
  });

  it("점수는 상한을 넘지 않는다 — 라벨 정확 매칭(1.0)에 닿으면 안 된다", () => {
    const learned = learner();
    for (let i = 0; i < 50; i++) {
      learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now: T0 + i });
    }

    const score = learned.match("돈부쳐")[0]!.score;
    expect(score).toBe(CONFIG.learning.maxScore);
    expect(score).toBeLessThan(1);
  });

  it("한 표현이 두 메뉴로 갈렸으면 둘 다 남긴다 — 고르는 것은 사용자다", () => {
    const learned = learner();
    learned.learn({ query: "이체", menuId: "transfer", foundAlready: MISSED, now: T0 });
    learned.learn({ query: "이체", menuId: "autoTransfer", foundAlready: MISSED, now: T0 });

    expect(learned.match("이체").map((m) => m.menuId)).toEqual(["transfer", "autoTransfer"]);
  });

  it("자주 간 쪽을 앞에 둔다", () => {
    const learned = learner();
    learned.learn({ query: "이체", menuId: "transfer", foundAlready: MISSED, now: T0 });
    learned.learn({ query: "이체", menuId: "autoTransfer", foundAlready: MISSED, now: T0 });
    learned.learn({ query: "이체", menuId: "autoTransfer", foundAlready: MISSED, now: T0 + 1 });

    expect(learned.match("이체")[0]!.menuId).toBe("autoTransfer");
  });
});

/*
 * 여기가 이 기능에서 가장 위험한 자리다. 검색어는 사용자가 친 문장이고, 문장에는
 * 금액과 계좌번호와 사람 이름이 들어온다. 기획안 §11.1이 저장을 금지한 것들이다.
 *
 * 막는 방법은 **숫자를 통째로 거절하는 것**이다. 금액도 계좌번호도 날짜도 숫자로 온다.
 * 대가는 "1억 만들기" 같은 표현을 못 배우는 것인데, 계좌번호 한 줄이 기기에 남는 것보다
 * 그 편이 싸다. 정규화는 특수문자를 지우므로 숫자만 보면 된다.
 */
describe("배우지 않는 것 — 기획안 §11.1", () => {
  it("숫자가 든 질의는 배우지 않는다 (금액)", () => {
    const learned = learner();
    expect(
      learned.learn({ query: "5만원 보내줘", menuId: "transfer", foundAlready: MISSED, now: T0 }),
    ).toBe(false);
    expect(learned.size).toBe(0);
  });

  it("숫자가 든 질의는 배우지 않는다 (계좌번호)", () => {
    const learned = learner();
    expect(
      learned.learn({
        query: "110-234-567890 으로 이체",
        menuId: "transfer",
        foundAlready: MISSED,
        now: T0,
      }),
    ).toBe(false);
  });

  it("긴 문장은 배우지 않는다 — 다시 나올 리 없고 실어 나르는 것만 는다", () => {
    const learned = learner();
    // "가"로 만들면 안 된다 — 격조사라 정규화가 한 글자를 떼어 상한에 딱 맞아떨어진다.
    const long = "잔".repeat(CONFIG.learning.maxTermChars + 1);
    expect(
      learned.learn({ query: long, menuId: "transfer", foundAlready: MISSED, now: T0 }),
    ).toBe(false);
  });

  it("정규화하면 아무것도 남지 않는 질의는 배우지 않는다", () => {
    const learned = learner();
    expect(
      learned.learn({ query: "그냥 좀", menuId: "transfer", foundAlready: MISSED, now: T0 }),
    ).toBe(false);
  });

  it("한 글자는 배우지 않는다 — 긴 질의 어디에나 걸린다", () => {
    const learned = learner();
    expect(
      learned.learn({ query: "돈", menuId: "transfer", foundAlready: MISSED, now: T0 }),
    ).toBe(false);
  });

  it("판단은 밖에서도 쓸 수 있게 열어 둔다", () => {
    expect(isLearnable("돈부쳐", CONFIG)).toBe(true);
    expect(isLearnable("5만원", CONFIG)).toBe(false);
    expect(isLearnable("", CONFIG)).toBe(false);
  });

  it("꺼 두면 아무것도 배우지 않는다", () => {
    const learned = learner({ learning: { enabled: false } });
    expect(
      learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now: T0 }),
    ).toBe(false);
    expect(learned.match("돈부쳐")).toEqual([]);
  });
});

describe("잊는다", () => {
  it("오래 안 쓰인 표현은 버린다", () => {
    const learned = learner();
    learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now: T0 });

    const later = T0 + (CONFIG.learning.forgetAfterDays + 1) * DAY_MS;
    learned.rollup(later);

    expect(learned.size).toBe(0);
  });

  it("계속 쓰이는 표현은 살아남는다", () => {
    const learned = learner();
    learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now: T0 });

    const later = T0 + (CONFIG.learning.forgetAfterDays + 1) * DAY_MS;
    learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now: later });
    learned.rollup(later);

    expect(learned.size).toBe(1);
  });

  /*
   * 상한이 없으면 기기에 남는 표현이 무한히 는다. 색인이 커지는 것도 문제지만,
   * 그보다 사용자가 자기 기기에 무엇이 쌓였는지 알 수 없게 되는 것이 문제다.
   */
  it("상한을 넘으면 덜 쓰이고 오래된 것부터 버린다", () => {
    const learned = learner({ learning: { maxTerms: 2 } });
    learned.learn({ query: "가나다", menuId: "a", foundAlready: MISSED, now: T0 });
    learned.learn({ query: "라마바", menuId: "b", foundAlready: MISSED, now: T0 + 1 });
    learned.learn({ query: "가나다", menuId: "a", foundAlready: MISSED, now: T0 + 2 });
    learned.learn({ query: "사아자", menuId: "c", foundAlready: MISSED, now: T0 + 3 });

    expect(learned.snapshot().map((t) => t.term).sort()).toEqual(["가나다", "사아자"]);
  });

  it("사용자가 하나를 지울 수 있다", () => {
    const learned = learner();
    learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now: T0 });
    learned.learn({ query: "돈 부쳐", menuId: "autoTransfer", foundAlready: MISSED, now: T0 });

    learned.forget("돈부쳐", "transfer");

    expect(learned.match("돈부쳐").map((m) => m.menuId)).toEqual(["autoTransfer"]);
  });

  it("사용자가 전부 지울 수 있다", () => {
    const learned = learner();
    learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now: T0 });
    learned.forgetAll();
    expect(learned.size).toBe(0);
  });
});

describe("저장", () => {
  it("스냅샷으로 왕복한다 — 다른 언어로 포팅해도 같은 JSON이다", () => {
    const learned = learner();
    learned.learn({ query: "돈 부쳐", menuId: "transfer", foundAlready: MISSED, now: T0 });

    const restored = new LearnedTerms(CONFIG, learned.snapshot());

    expect(restored.snapshot()).toEqual(learned.snapshot());
    expect(restored.match("돈부쳐")).toEqual(learned.match("돈부쳐"));
  });

  it("저장된 것이 없으면 빈 채로 시작한다", () => {
    expect(new LearnedTerms(CONFIG).snapshot()).toEqual([]);
    expect(new LearnedTerms(CONFIG, []).snapshot()).toEqual([]);
  });
});
