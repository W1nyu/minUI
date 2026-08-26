import type { ColdStartPresets, MenuCatalog } from "@minui/core";

/**
 * Studio를 **미리 담아 둔 결과로 재생한다.**
 *
 * <p>Studio는 Playwright로 남의 사이트를 실제로 긁는다. 그것을 배포에 넣으려면 이미지에
 * Chrome이 1.5GB 붙고, 데이터센터 IP는 은행 WAF에 막히기 쉬우며, KB국민은행은
 * `robots.txt`가 `Disallow: /`로 전면 금지다. 심사위원 앞에서 그 셋 중 하나만 걸려도
 * 화면이 죽는다.
 *
 * <p>그래서 로컬에서 한 번 실제로 긁어 `tools/src/build-studio-samples.ts`로 굽고,
 * 배포에서는 그 결과를 <b>같은 단계·같은 시간으로 흘려</b> 보여 준다. 수치는 실측이고
 * 조립도 CLI와 같은 함수를 거친 것이라 <b>지어낸 값이 하나도 없다.</b>
 *
 * <p><b>모르는 주소는 정직하게 거절한다.</b> 아무 주소나 넣으면 되는 척하지 않는다 —
 * 무엇을 보고 있는지 모르는 데모가 제일 나쁘다는 것이 이 저장소의 원칙이다.
 *
 * <p>표본은 <b>동적 import</b>로 읽는다. 카탈로그가 통째로 들어 있어 셋을 합치면 750KB인데,
 * Studio에 들어오지 않는 사람에게까지 그것을 받게 할 이유가 없다.
 */

export interface StudioResult {
  site: string;
  host: string;
  catalog: MenuCatalog;
  presets: ColdStartPresets;
  steps: { name: string; detail: string; ms: number }[];
  problems: string[];
  stats: {
    harvested: number;
    menus: number;
    branches: number;
    duplicateLabels: number;
    highRisk: number;
    codedIds: number;
  };
}

/**
 * 미리 구워 둔 사이트. `build-studio-samples.ts`의 목록과 같아야 한다.
 *
 * <p>`unknown`으로 받는 이유: JSON을 import하면 `riskLevel`이 `"high"`가 아니라
 * `string`으로 넓혀져 `MenuItem`에 안 맞는다. 값을 만든 것이 같은 저장소의
 * `buildMenus`이므로 여기서 좁힌다.
 */
const SAMPLES: Record<string, () => Promise<{ default: unknown }>> = {
  kebhana: () => import("./studio-samples/kebhana.json"),
  shinhan: () => import("./studio-samples/shinhan.json"),
  kbsec: () => import("./studio-samples/kbsec.json"),
};

/**
 * 주소에서 표본 이름을 찾는다.
 *
 * <p>`services/harvester/src/harvest.ts`의 `siteNameFrom`과 같은 일을 하지만, 그 함수는
 * Playwright를 끌고 오는 모듈에 있어 브라우저로 못 가져온다. 규칙이 단순해 여기서 다시 쓴다 —
 * 호스트에서 `www.`와 최상위 도메인을 떼고 남는 이름.
 */
export function sampleNameFrom(input: string): string | null {
  let host: string;
  try {
    host = new URL(/^https?:/i.test(input) ? input : `https://${input}`).hostname;
  } catch {
    return null;
  }
  const stem = host.toLowerCase().replace(/^(www|m|obank|securities|bank)\./, "").split(".")[0];
  return stem && stem in SAMPLES ? stem : null;
}

export interface StudioRunner {
  /** 단계 하나가 끝날 때마다 부른다. 진행이 눈에 보여야 10초가 10초로 느껴진다. */
  onStep?: (step: StudioResult["steps"][number]) => void;
}

/**
 * @returns 결과, 또는 왜 못 했는지. 예외를 던지지 않는다 — 화면이 이미 그 자리를 갖고 있다.
 */
export async function runStudio(
  url: string,
  options: StudioRunner = {},
): Promise<{ result: StudioResult } | { error: string }> {
  const name = sampleNameFrom(url);

  if (name) {
    const loaded = await SAMPLES[name]!();
    const result = loaded.default as StudioResult;

    // 실제로 걸린 시간만큼 단계를 흘린다. 즉시 다 뜨면 "10초 만에 얹었다"가 안 보인다.
    for (const step of result.steps) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(step.ms, 4_000)));
      options.onStep?.(step);
    }
    return { result };
  }

  // 로컬 개발에는 진짜 수집기가 살아 있다. 있으면 그쪽이 답한다.
  try {
    const response = await fetch("/api/studio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const body = (await response.json()) as StudioResult & { error?: string };
    if (body.error) return { error: body.error };
    return { result: body };
  } catch {
    return {
      error:
        "이 배포에는 아래 세 곳만 미리 담아 두었습니다. 임의의 주소를 넣어 보려면 " +
        "저장소를 내려받아 `pnpm --filter demos dev`로 띄워 주세요 — 그때는 수집기가 실제로 돕니다.",
    };
  }
}
