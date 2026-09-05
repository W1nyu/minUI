import type { MenuCatalog } from "../types.js";
import type { MenuPrior } from "./prior.js";

/**
 * 인식기에 미리 알려 줄 말 (M22, 기획안 §9.2).
 *
 * <p><b>왜 이것이 검색이 아니라 인식의 문제인가.</b> M21이 되찾지 못한 오류는 전부
 * 같은 모양이었다 — `자동이체` → `자동차`, `돈 부쳐야 하는데` → `동두천`. 발음 변이가
 * 아니라 <b>어휘 치환</b>이고, 원인은 인식기가 자기가 은행 앱에서 듣고 있다는 걸
 * 모른다는 것 하나다. 카탈로그를 아는 쪽은 우리인데 그 지식을 인식기에게 한 번도
 * 준 적이 없다.
 *
 * <p>M21의 혼동 비용표는 <b>애초에 안 났어도 될 오류를 사후에 수선하는 장치</b>였다.
 * 이 파일은 그 오류가 나기 전에 개입한다.
 *
 * <h3>코어는 인식기를 모른다</h3>
 *
 * <p>여기가 만드는 것은 <b>말과 무게의 목록</b>뿐이다. 그것을 `SpeechRecognitionPhrase`로
 * 바꿔 넣는 일은 `@minui/voice`가 하고, 언제 넣을지는 호스트가 정한다(불변 규칙 1).
 *
 * <h3>개인정보</h3>
 *
 * <p>여기서 나오는 말은 <b>공개 카탈로그의 메뉴 이름과 사람이 쓴 동의어</b>다.
 * 개인정보가 아니다. 기기에서 배운 개인 동의어(M7)는 <b>부르는 쪽이 따로 넣는다</b> —
 * 그것은 이 기기를 떠나면 안 되는 값이라, 인식이 기기 안에서 도는 경로에서만 붙인다.
 */

/** 인식기에 넘길 말 하나. */
export interface BiasPhrase {
  phrase: string;
  /** 0..10. 브라우저가 이 범위를 강제한다 — 벗어나면 생성자가 던진다. */
  boost: number;
}

export interface BiasSettings {
  /** 인식기에 말을 알려 줄 것인가. 기본은 `false` — 게이트를 넘기 전에는 켜지 않는다. */
  enabled: boolean;
  /**
   * 몇 개까지 넘길 것인가.
   *
   * <p>카탈로그가 사이트당 900개를 넘는데 통째로 넘기면 편향이 희석된다. 무엇을 남길지는
   * <b>사전확률이 답한다</b> — 이 사용자가 실제로 쓰는 쪽부터 채운다. 사전확률이 여기서
   * 두 번째 일을 하는 것이 이 설계의 값이다.
   */
  maxPhrases: number;
  /** 아무 기록이 없는 말에도 주는 기본 무게. */
  baseBoost: number;
  /** 사전확률 1인 말이 기본 무게에 더 받는 양. */
  priorBoost: number;
  /**
   * 오디오가 기기를 떠나지 않는 인식을 <b>쓸 수 있으면</b> 쓴다.
   *
   * <p>강요하지 않는다 — 언어팩이 없으면 내려받게 하지 않고 조용히 지금까지의 경로로 돈다.
   */
  preferLocal: boolean;
}

/** 브라우저가 강제하는 범위. 여기서 미리 자른다 — 호스트가 던지게 두지 않는다. */
const MIN_BOOST = 0;
const MAX_BOOST = 10;

/**
 * 카탈로그와 사전확률로 편향 목록을 만든다.
 *
 * <p><b>정규화하지 않은 원문을 쓴다.</b> `MenuIndex.terms`는 조사를 떼고 공백을 지운
 * 검색용 형태라 사람이 실제로 말하지 않는다. 인식기에 줄 것은 발화형이다.
 *
 * @param extra 이 기기에서 배운 말 등, 카탈로그 밖에서 온 말. 맨 앞에 놓인다 —
 *   사용자가 그 말을 실제로 썼다는 <b>직접 증거</b>라 카탈로그 이름보다 강한 근거다.
 */
export function buildBiasPhrases(
  catalog: MenuCatalog,
  prior: MenuPrior,
  settings: BiasSettings,
  extra: readonly string[] = [],
): BiasPhrase[] {
  if (!settings.enabled || settings.maxPhrases <= 0) return [];

  const out: BiasPhrase[] = [];
  const seen = new Set<string>();

  const push = (raw: string, weight: number) => {
    const phrase = raw.trim();
    if (phrase.length === 0 || seen.has(phrase)) return;
    seen.add(phrase);
    out.push({ phrase, boost: clamp(weight) });
  };

  for (const phrase of extra) push(phrase, settings.baseBoost + settings.priorBoost);

  /*
   * 사전확률이 높은 메뉴부터. 같으면 카탈로그 순서를 지킨다 — 수집 원본이 DOM 순서라
   * 그 자체가 사이트가 정한 중요도다. 기록이 없는 사용자에게는 이것이 유일한 순서가 된다.
   */
  const ordered = catalog
    .map((menu, index) => ({ menu, index, weight: prior.get(menu.id) ?? 0 }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const { menu, weight } of ordered) {
    if (out.length >= settings.maxPhrases) break;
    const boost = settings.baseBoost + settings.priorBoost * weight;
    push(menu.label, boost);
    for (const synonym of menu.synonyms ?? []) {
      if (out.length >= settings.maxPhrases) break;
      push(synonym, boost);
    }
  }

  return out.slice(0, settings.maxPhrases);
}

function clamp(boost: number): number {
  if (!Number.isFinite(boost)) return MIN_BOOST;
  return Math.min(MAX_BOOST, Math.max(MIN_BOOST, boost));
}
