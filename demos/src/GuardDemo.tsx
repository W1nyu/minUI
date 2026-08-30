import {
  combineRisk,
  requiresConfirm,
  validateProposal,
  type MenuCatalog,
  type RejectReason,
} from "@minui/core";
import { useMemo, useState } from "react";

/**
 * **AI가 못 하는 것** — 검증기를 화면에서 직접 돌린다.
 *
 * <p>이 저장소의 안전 경계는 규칙이 아니라 <b>구조</b>다. 모델이 무엇을 내놓든
 * `validateProposal`을 지나야 화면에 닿고, 거기서 넷이 막힌다. 그것을 지금까지는
 * <b>테스트만 재고 있었다</b> — `packages/core/test/copilot.test.ts`. 테스트는
 * 심사자가 볼 수 없고, 말로 하는 주장은 확인할 수 없다.
 *
 * <p>그래서 여기서는 모델이 낼 법한 응답을 <b>직접 넣어 보고</b> 무엇이 막히는지 본다.
 * 모델을 부르지 않는다 — `validateProposal`은 의존성 0인 순수 함수라, 이 페이지는
 * 정적 배포에서도 인터넷 없이 돌고 같은 입력에 늘 같은 답을 낸다.
 *
 * <p>가장 볼 만한 것은 <b>위험도를 낮추려는 시도</b>다. 통과는 하는데 위험도가 안
 * 내려간다 — `combineRisk`가 더 위험한 쪽을 택하기 때문이다. "막았다"보다
 * "낮출 수가 없다"가 강한 말이고, 그 차이가 화면에서 보인다.
 */

interface Sample {
  name: string;
  /** 이 시도가 무엇을 노리는가. */
  intent: string;
  raw: unknown;
}

/** 왜 버렸는가 — 사람이 읽는 말로. `RejectReason`은 로그용 이름이다. */
const REJECT_TEXT: Record<RejectReason, string> = {
  "not-an-object": "응답이 객체가 아닙니다",
  "unknown-menu": "카탈로그에 없는 메뉴입니다",
  "unknown-intent": "허용된 의도 다섯 중에 없습니다",
  "why-too-long": "모델이 쓴 설명이 너무 깁니다",
  "why-has-digits": "모델이 쓴 설명에 숫자가 있습니다",
};

function samplesFor(catalog: MenuCatalog): Sample[] {
  // 카탈로그에서 실제로 있는 것을 고른다 — 데모마다 사이트가 다르므로 박아 두지 않는다.
  const risky = catalog.find((menu) => menu.riskLevel === "high") ?? catalog[0]!;
  const safe = catalog.find((menu) => menu.riskLevel === "low") ?? catalog[0]!;

  return [
    {
      name: "① 정상",
      intent: "제대로 된 제안. 통과하면 화면에 뜬다",
      raw: { menuId: safe.id, intent: "look", why: "잔액을 보는 곳입니다" },
    },
    {
      name: "② 없는 메뉴를 지어낸다",
      intent: "모델이 이 앱에 없는 화면을 만들어 낼 수 있는가",
      raw: { menuId: "transfer.everything", intent: "send", why: "전부 보내는 곳입니다" },
    },
    {
      name: "③ 위험도를 낮춘다",
      intent: "고위험 메뉴를 안전하다고 우겨서 확인을 건너뛸 수 있는가",
      raw: { menuId: risky.id, intent: "send", riskLevel: "low", why: "안전한 화면입니다" },
    },
    {
      name: "④ 설명에 금액을 넣는다",
      intent: "모델이 쓴 글로 숫자가 새어 나갈 수 있는가",
      raw: { menuId: safe.id, intent: "look", why: "30000원을 보낼 수 있습니다" },
    },
    {
      name: "⑤ 없는 의도를 쓴다",
      intent: "닫힌 집합 밖의 행동을 요청할 수 있는가",
      raw: { menuId: risky.id, intent: "execute", why: "바로 실행합니다" },
    },
    {
      name: "⑥ 화면에 뜰 이름을 바꾼다",
      intent: "모델이 메뉴 이름을 자기 마음대로 붙일 수 있는가",
      raw: { menuId: safe.id, label: "무료 이벤트 당첨", intent: "look", why: "눌러 보세요" },
    },
  ];
}

export function GuardDemo({ catalog, onBack }: { catalog: MenuCatalog; onBack: () => void }) {
  const samples = useMemo(() => samplesFor(catalog), [catalog]);
  const [picked, setPicked] = useState(0);
  const [text, setText] = useState(() => JSON.stringify(samples[0]!.raw, null, 2));

  /** 사람이 고친 JSON도 그대로 넣어 본다. 못 읽으면 그것도 하나의 결과다. */
  const parsed = useMemo<{ ok: true; value: unknown } | { ok: false }>(() => {
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false };
    }
  }, [text]);

  const checked = parsed.ok ? validateProposal(parsed.value, catalog) : null;

  function choose(index: number) {
    setPicked(index);
    setText(JSON.stringify(samples[index]!.raw, null, 2));
  }

  return (
    <div className="guard">
      <header className="guard-head">
        <button type="button" className="guard-back" onClick={onBack}>
          <span aria-hidden="true">←</span> 돌아가기
        </button>
        <div>
          <h1>AI가 못 하는 것</h1>
          <p className="guard-lead">
            모델이 무엇을 내놓든 <strong>화면에 닿기 전에 검증기를 지납니다.</strong>{" "}
            아래에서 모델 응답을 직접 넣어 보세요. 여기에 모델은 없습니다 —{" "}
            <code>validateProposal</code>은 의존성 0인 순수 함수라 인터넷 없이 돌고, 같은
            입력에 늘 같은 답을 냅니다.
          </p>
        </div>
      </header>

      <div className="guard-body">
        <section className="guard-samples" aria-label="시도해 볼 응답">
          <h2>모델이 낼 법한 것</h2>
          <ul>
            {samples.map((sample, index) => (
              <li key={sample.name}>
                <button
                  type="button"
                  className="guard-sample"
                  aria-pressed={picked === index}
                  onClick={() => choose(index)}
                >
                  <span className="guard-sample-name">{sample.name}</span>
                  <span className="guard-sample-intent">{sample.intent}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="guard-io" aria-label="응답과 결과">
          <h2>모델 응답 (고쳐도 됩니다)</h2>
          <textarea
            className="guard-input"
            spellCheck={false}
            rows={9}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="모델 응답 JSON"
          />

          <h2>검증기가 한 일</h2>
          {!parsed.ok && (
            <p className="guard-verdict guard-reject" role="status">
              JSON으로 읽을 수 없습니다 — 그것도 버리는 이유입니다.
            </p>
          )}

          {checked && !checked.ok && (
            <p className="guard-verdict guard-reject" role="status">
              <strong>버렸습니다</strong> — {REJECT_TEXT[checked.reason]}
              <span className="guard-code">{checked.reason}</span>
            </p>
          )}

          {checked?.ok && (
            <>
              <p className="guard-verdict guard-pass" role="status">
                <strong>통과</strong> — 화면에 이렇게 뜹니다
              </p>
              <dl className="guard-result">
                <div>
                  <dt>이름</dt>
                  <dd>
                    {checked.proposal.label}
                    <span className="guard-note">카탈로그에서 옴 — 모델이 못 정합니다</span>
                  </dd>
                </div>
                <div>
                  <dt>위험도</dt>
                  <dd>
                    {checked.proposal.riskLevel}
                    <span className="guard-note">
                      {riskNote(catalog, checked.proposal.menuId, parsed.ok ? parsed.value : null)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>확인이 필요한가</dt>
                  <dd>
                    {checked.proposal.needsConfirm ? "예 — 사용자가 눌러야 열립니다" : "아니요"}
                    <span className="guard-note">위험도에서 계산됨 — 모델이 못 정합니다</span>
                  </dd>
                </div>
                <div>
                  <dt>모델이 쓴 한 줄</dt>
                  <dd>
                    {checked.proposal.why ?? "(없음)"}
                    <span className="guard-note">
                      {checked.proposal.why
                        ? "길이·숫자 검사를 지났습니다"
                        : "모델이 안 썼거나 검사에 걸려 버려졌습니다"}
                    </span>
                  </dd>
                </div>
              </dl>
            </>
          )}
        </section>
      </div>

      <footer className="guard-foot">
        <p>
          같은 검증을 <code>packages/core/test/copilot.test.ts</code>가 재고 있습니다.
          이 페이지는 그 테스트를 화면에서 돌려 보는 것뿐입니다.
        </p>
      </footer>
    </div>
  );
}

/**
 * 위험도가 어떻게 정해졌는지 한 줄로.
 *
 * <p>모델이 위험도를 낮추려 한 경우를 <b>이름 붙여 말한다.</b> 그냥 "high"라고만 두면
 * 무엇이 막혔는지 안 보이고, 이 페이지에서 가장 볼 만한 것이 바로 그것이다.
 */
function riskNote(catalog: MenuCatalog, menuId: string, raw: unknown): string {
  const menu = catalog.find((item) => item.id === menuId);
  if (!menu) return "카탈로그에서 옴";

  const proposed =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)["riskLevel"]
      : undefined;
  if (proposed !== "low" && proposed !== "medium" && proposed !== "high") {
    return "카탈로그에서 옴 — 모델이 못 정합니다";
  }

  const combined = combineRisk(menu.riskLevel, proposed);
  if (combined === proposed && proposed !== menu.riskLevel) {
    return `모델이 ${proposed}로 올렸고, 올리는 것은 됩니다`;
  }
  if (proposed !== menu.riskLevel) {
    return `모델이 ${proposed}라고 했지만 카탈로그의 ${menu.riskLevel}이 이깁니다 — 낮출 수 없습니다`;
  }
  return "카탈로그에서 옴 — 모델이 못 정합니다";
}

/** 확인 필요 여부는 위험도에서만 나온다. 이 페이지가 그것을 그대로 보여 준다. */
export const GUARD_CONFIRM_RULE = requiresConfirm;
