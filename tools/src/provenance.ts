import type { BuildResult } from "./build-catalog.js";

/**
 * 카탈로그가 **언제, 어디서, 얼마나 믿을 만하게** 왔는가.
 *
 * <p>이식형 UI의 핵심 자산은 카탈로그다. 그런데 그 재료는 남의 사이트이고, 남의 사이트는
 * 예고 없이 바뀐다 — 메뉴를 없애고, 문구를 갈고, 주소 체계를 통째로 옮긴다. 그때
 * <b>가장 나쁜 실패는 조용한 실패다.</b> 수집이 절반만 성공해 메뉴 930개가 40개가 돼도
 * 화면은 멀쩡히 뜨고, 검색만 조용히 나빠진다. 아무도 모른 채 시연에 들고 간다.
 *
 * <p>그래서 두 가지를 한다. 하나는 <b>출처를 기록으로 남기는 것</b>, 다른 하나는
 * <b>지난번과 견줘 급변을 실패로 만드는 것</b>이다. 기록만 있고 비교가 없으면 아무도
 * 안 읽는 파일이 하나 늘 뿐이다.
 *
 * <p>여기 있는 것은 전부 순수 함수다. 파일을 읽고 쓰는 일은 `build-catalog-cli.ts`가 한다.
 */

export interface SiteProvenance {
  /** 어느 사이트에서 긁었나. */
  host: string;
  /** 수집한 시각. 수집 원본(`*.raw.json`)이 적어 둔 것을 그대로 옮긴다. */
  capturedAt: string;
  /** 그 사이트를 긁을 때 알아야 했던 것. */
  note?: string;
  /** 이 카탈로그의 메뉴 수. */
  menus: number;
  /** 원본 항목 수. `menus`와의 차이가 걸러 낸 양이다. */
  rawItems: number;
  /** 어디에도 붙지 못한 사람 손 override. **0이 아니면 사람이 봐야 한다.** */
  orphans: number;
  /** id가 끊어져 라벨로 다시 붙인 override. 자동이지만 눈으로 확인할 것. */
  remaps: number;
}

export interface Provenance {
  /** 이 파일을 만든 시각. 수집 시각과 다르다 — 재빌드는 수집이 아니다. */
  builtAt: string;
  sites: Record<string, SiteProvenance>;
}

/**
 * 메뉴 수가 이만큼 넘게 줄면 **수집이 깨진 것으로 본다.**
 *
 * <p>사이트가 진짜로 메뉴를 20% 넘게 줄이는 일은 드물다. 그보다는 로그인이 풀렸거나,
 * 동적 렌더링이 끝나기 전에 읽었거나, 선택자가 바뀐 쪽이 훨씬 잦다. 진짜 개편이라면
 * 사람이 확인하고 새 기준을 커밋하면 된다 — <b>확인하는 사람이 있는 편이 낫다.</b>
 */
const COLLAPSE_RATIO = 0.2;

/** 수집이 이보다 오래되면 "최신 메뉴"라고 말할 수 없다. */
const STALE_DAYS = 180;

export interface Drift {
  /** 빌드를 실패시킬 것. */
  failures: string[];
  /** 사람이 봐야 하지만 막지는 않을 것. */
  warnings: string[];
}

/** `BuildResult`에서 기록할 것만 뽑는다. */
export function provenanceOf(results: BuildResult[], now: Date = new Date()): Provenance {
  const sites: Record<string, SiteProvenance> = {};
  for (const r of results) {
    sites[r.site] = {
      host: r.source.host,
      capturedAt: r.source.capturedAt,
      ...(r.source.note ? { note: r.source.note } : {}),
      menus: r.menus.length,
      rawItems: r.stats.raw,
      orphans: r.orphans.length,
      remaps: r.remaps.length,
    };
  }
  return { builtAt: now.toISOString(), sites };
}

const days = (from: string, to: Date): number =>
  (to.getTime() - new Date(from).getTime()) / 86_400_000;

/**
 * 지난번 기록과 견준다. **처음이면 비교할 것이 없으니 통과다.**
 *
 * <p>`previous`가 없을 때 실패시키면 새 사이트를 추가할 수 없다. 비교는 기준이 있을 때만
 * 성립한다는 것을 그대로 둔다.
 */
export function checkDrift(
  previous: Provenance | undefined,
  next: Provenance,
  now: Date = new Date(),
): Drift {
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const [site, after] of Object.entries(next.sites)) {
    if (after.orphans > 0) {
      warnings.push(
        `${site}: 붙지 못한 override ${after.orphans}건 — 사이트가 그 메뉴를 없앴거나 문구를 바꿨다`,
      );
    }
    if (after.remaps > 0) {
      warnings.push(`${site}: id가 끊어져 다시 붙인 override ${after.remaps}건 — 눈으로 확인할 것`);
    }

    const age = days(after.capturedAt, now);
    if (Number.isNaN(age)) {
      failures.push(`${site}: capturedAt을 읽을 수 없다 — "${after.capturedAt}"`);
    } else if (age > STALE_DAYS) {
      warnings.push(
        `${site}: 수집한 지 ${age.toFixed(0)}일 됐다 — 화면에서 "최신 메뉴"라고 말하지 않는지 확인할 것`,
      );
    }

    const before = previous?.sites[site];
    if (!before) continue;

    if (after.menus < before.menus * (1 - COLLAPSE_RATIO)) {
      const lost = before.menus - after.menus;
      failures.push(
        `${site}: 메뉴가 ${before.menus}개 → ${after.menus}개로 ${lost}개 줄었다. ` +
          `사이트가 정말 그만큼 줄인 게 아니라면 수집이 깨진 것이다 ` +
          `(로그인 풀림·동적 렌더링·선택자 변경). 확인했으면 이 기록을 함께 커밋한다`,
      );
    }
  }

  for (const site of Object.keys(previous?.sites ?? {})) {
    if (!next.sites[site]) {
      failures.push(`${site}: 기록에 있었는데 이번 빌드에 없다 — 수집 원본이 사라졌나`);
    }
  }

  return { failures, warnings };
}
