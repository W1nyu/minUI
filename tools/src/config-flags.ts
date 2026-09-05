import { DEFAULT_CONFIG, UNIFORM_COSTS, type MinUIConfig } from "@minui/core";

/**
 * 벤치를 돌릴 때 M21을 통째로 되돌리는 레버 (M21).
 *
 * <p><b>기본값이 켜진 뒤로 방향이 뒤집혔다.</b> 처음에는 꺼져 있는 단계를 켜는 레버였는데,
 * 2026-09-05에 게이트를 통과해 `phonology`·`nbest`·`confusion`이 기본값이 되었다.
 * 이제 필요한 것은 <b>켜기</b>가 아니라 <b>끄기</b>다 — 같은 세트에서 전후를 비교하려면
 * 이전 상태를 만들 수 있어야 한다.
 *
 * <p>레버가 한 곳에 있어야 하는 이유는 그대로다. 벤치마다 설정을 손으로 만들면 한쪽만
 * 고쳐지고, 그러면 비교가 아니라 두 개의 다른 실험이 된다.
 *
 * <pre>
 *   pnpm --filter tools bench:sites                     # 지금 값
 *   MINUI_PRE_M21=1 pnpm --filter tools bench:sites     # M21을 끄고 같은 세트를
 * </pre>
 */
export function benchConfig(): MinUIConfig {
  if (process.env["MINUI_PRE_M21"] !== "1") return DEFAULT_CONFIG;

  return {
    ...DEFAULT_CONFIG,
    search: {
      ...DEFAULT_CONFIG.search,
      phonology: { ...DEFAULT_CONFIG.search.phonology, enabled: false },
      confusion: UNIFORM_COSTS,
      nbest: { ...DEFAULT_CONFIG.search.nbest, enabled: false },
    },
  };
}

/** 지금 어떤 레버가 올라가 있는지 한 줄로. 리포트 머리에 찍어 둔다. */
export function benchFlags(): string {
  return process.env["MINUI_PRE_M21"] === "1" ? "M21 끔" : "지금 값";
}
