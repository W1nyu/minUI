import { jamoSimilarity, toJamo } from "./hangul.js";

/**
 * 학습된 자모 혼동 비용 (M21, 기획안 §8.3 ④-2).
 *
 * <p><b>왜 균일 편집거리로는 모자란가.</b> `hangul.ts`의 `jamoDistance`는 ㅐ↔ㅔ와 ㄱ↔ㅎ의
 * 비용이 같다. 그러나 STT가 실제로 헷갈리는 자리는 균일하지 않다 — 어떤 자리는 거의 언제나
 * 틀리고 어떤 자리는 거의 틀리지 않는다. 그 <b>어느 자리인지</b>는 사람이 앉아서 짐작할
 * 것이 아니라 코퍼스가 답할 것이다.
 *
 * <p>이 파일은 잡음 채널의 <b>가능도</b> `P(들린말 | 의도)`를 맡는다. 사전확률
 * `P(의도)`는 기존 사용 이력 개인화가 이미 하는 일이므로 여기서 결합하지 않는다.
 *
 * <p><b>비용표가 비면 기존 동작과 값이 같다.</b> 테스트가 그것을 고정한다 — 학습 전에
 * 켜도 아무것도 바뀌지 않아야 코퍼스의 기여만 따로 잴 수 있다.
 *
 * <p>표는 `MinUIConfig`에 실려 다닌다(불변 규칙 3). 학습은 저장소 밖의 도구가 하고
 * (`pnpm --filter tools fit:confusion`), 엔진은 결과 JSON만 읽는다.
 */

/**
 * 자모 하나를 다른 자모로 잘못 들었을 때의 비용. 0에 가까울수록 "흔한 오인식이라 덜 깎는다".
 *
 * <p>열쇠는 `"의도한자모>들린자모"` 형태다. <b>방향이 있다</b> — ㅊ을 ㅈ으로 듣는 것과
 * ㅈ을 ㅊ으로 듣는 것은 빈도가 다르다.
 */
export interface ConfusionCosts {
  /** `"ᄎ>ᄌ"` → 0.12 */
  subs: Record<string, number>;
  /** 없던 소리가 끼어든 비용. 열쇠는 들린 자모. */
  ins: Record<string, number>;
  /** 있어야 할 소리가 빠진 비용. 열쇠는 의도한 자모. */
  del: Record<string, number>;
  /** 표에 없는 치환의 비용. */
  defaultSub: number;
  /** 표에 없는 삽입의 비용. */
  defaultIns: number;
  /** 표에 없는 삭제의 비용. */
  defaultDel: number;
}

/**
 * 아무것도 배우지 않은 표. 이것으로 잰 값은 `jamoSimilarity`와 정확히 같다.
 *
 * <p>기본값이 여기인 이유: 코퍼스가 없는 호스트에서도 이 단계가 <b>손해를 끼치지 않는다</b>는
 * 것이 켜고 끄는 판단의 출발점이어야 한다.
 */
export const UNIFORM_COSTS: ConfusionCosts = {
  subs: {},
  ins: {},
  del: {},
  defaultSub: 1,
  defaultIns: 1,
  defaultDel: 1,
};

/** 정렬 결과 한 칸. 학습이 이것을 세어 표를 만든다. */
export type AlignOp =
  | { kind: "match"; intended: string; heard: string }
  | { kind: "sub"; intended: string; heard: string }
  /** 들린 쪽에만 있다. */
  | { kind: "ins"; heard: string }
  /** 의도한 쪽에만 있다. */
  | { kind: "del"; intended: string };

/**
 * 의도한 말과 들린 말을 자모 수준에서 맞춰 세운다.
 *
 * <p><b>균일 비용으로 정렬한다.</b> 배우려는 그 비용으로 정렬하면 학습이 자기 자신을
 * 강화한다 — 싸다고 배운 자리가 더 자주 정렬되고, 그래서 더 싸진다. 정렬은 중립이어야 한다.
 *
 * <p>둘 다 `pronounce()`를 지난 문자열을 기대한다. 소리끼리 맞춰야 남는 차이가
 * <b>표기 규칙이 아니라 오인식</b>이다.
 */
export function alignJamo(intended: string, heard: string): AlignOp[] {
  const a = toJamo(intended);
  const b = toJamo(heard);

  // 표준 편집거리 표. 되짚어 갈 것이므로 전체를 들고 있는다.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    table.push(row);
  }
  for (let j = 0; j < cols; j++) table[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = a[i - 1] === b[j - 1];
      table[i]![j] = Math.min(
        table[i - 1]![j - 1]! + (same ? 0 : 1),
        table[i - 1]![j]! + 1,
        table[i]![j - 1]! + 1,
      );
    }
  }

  const ops: AlignOp[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    const here = table[i]![j]!;

    if (i > 0 && j > 0) {
      const same = a[i - 1] === b[j - 1];
      if (here === table[i - 1]![j - 1]! + (same ? 0 : 1)) {
        ops.push({ kind: same ? "match" : "sub", intended: a[i - 1]!, heard: b[j - 1]! });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && here === table[i - 1]![j]! + 1) {
      ops.push({ kind: "del", intended: a[i - 1]! });
      i--;
      continue;
    }
    ops.push({ kind: "ins", heard: b[j - 1]! });
    j--;
  }

  return ops.reverse();
}

/** 코퍼스 한 줄 — 무엇을 말했고 무엇으로 적혔는가. 소리 표기로 준다. */
export interface HeardPair {
  intended: string;
  heard: string;
}

/** 집계 결과. 비용으로 바꾸는 일은 도구가 한다 — 코어는 세기만 한다. */
export interface ConfusionTally {
  /** `"의도>들림"` → 횟수. 맞게 들린 것은 넣지 않는다. */
  subs: Map<string, number>;
  /** 들린 자모 → 끼어든 횟수. */
  ins: Map<string, number>;
  /** 의도한 자모 → 빠진 횟수. */
  del: Map<string, number>;
  /**
   * 의도한 자모가 코퍼스에 나온 횟수. **맞게 들린 것을 포함한다.**
   *
   * <p>확률의 분모다. 이것이 없으면 "ㅊ을 ㅈ으로 100번 잘못 들었다"가 흔한 오인식인지
   * ㅊ이 원래 만 번 나오는 흔한 소리인지 구별할 수 없다.
   */
  observed: Map<string, number>;
}

/** 코퍼스를 훑어 혼동을 센다. 비용으로 바꾸기 전 단계다. */
export function countConfusions(pairs: readonly HeardPair[]): ConfusionTally {
  const tally: ConfusionTally = {
    subs: new Map(),
    ins: new Map(),
    del: new Map(),
    observed: new Map(),
  };

  const bump = (map: Map<string, number>, key: string) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const pair of pairs) {
    for (const op of alignJamo(pair.intended, pair.heard)) {
      switch (op.kind) {
        case "match":
          bump(tally.observed, op.intended);
          break;
        case "sub":
          bump(tally.observed, op.intended);
          bump(tally.subs, `${op.intended}>${op.heard}`);
          break;
        case "del":
          bump(tally.observed, op.intended);
          bump(tally.del, op.intended);
          break;
        case "ins":
          bump(tally.ins, op.heard);
          break;
      }
    }
  }

  return tally;
}

/**
 * `needle`이 `haystack` 안에 (배운 오인식을 감안해) 얼마나 들어 있는가. 0..1.
 *
 * <p>`jamoSimilarity`와 <b>같은 자</b>를 쓴다 — 방향이 있고, needle을 haystack의 어느
 * 위치에든 맞춰 보며, needle 길이로만 나눈다. 다른 것은 한 칸의 값뿐이다.
 *
 * <p>`needle`은 메뉴가 <b>의도한</b> 소리이고 `haystack`은 <b>들린</b> 말이다.
 * 비용표의 방향이 그 순서를 따른다.
 */
export function weightedJamoSimilarity(
  haystack: string,
  needle: string,
  costs: ConfusionCosts,
): number {
  /*
   * **아무것도 배우지 않았으면 균일 편집거리다.** 값이 같을 뿐 아니라 훨씬 싸다 —
   * 아래 표 조회가 통째로 사라진다. 코퍼스가 없는 호스트에서 이 단계를 켜도
   * 지연을 물지 않게 하는 것이 이 갈래의 목적이다.
   */
  const table = lookup(costs);
  if (!table) return jamoSimilarity(haystack, needle);

  const source = toJamo(haystack);
  const target = toJamo(needle);

  if (target.length === 0 && source.length === 0) return 1;
  if (target.length === 0 || source.length === 0) return 0;

  /*
   * **삽입 비용은 열에만 달려 있다.** 칸마다 다시 찾으면 표 조회가 |질의| × |표현|번
   * 일어나는데, 실제로 필요한 것은 |질의|번뿐이다. 한 번 펼쳐 두고 쓴다 — 이 한 줄이
   * 홀드아웃 p95를 39ms에서 게이트 안으로 되돌렸다.
   */
  const insCost = new Array<number>(source.length + 1);
  for (let j = 1; j <= source.length; j++) {
    insCost[j] = table.ins.get(source[j - 1]!) ?? costs.defaultIns;
  }

  // 첫 행을 0으로 채워 haystack의 어느 지점에서 시작해도 비용이 없게 한다.
  let previous = new Array<number>(source.length + 1).fill(0);

  for (let i = 1; i <= target.length; i++) {
    const intended = target[i - 1]!;
    const row = table.subs.get(intended);
    const skipIntended = table.del.get(intended) ?? costs.defaultDel;
    const current = [previous[0]! + skipIntended];

    /*
     * 배운 치환이 없는 자모가 대부분이다(실측 코퍼스에서 치환 3개). 그런 행은
     * 안쪽에서 표를 아예 보지 않는다.
     */
    if (row === undefined) {
      const miss = costs.defaultSub;
      for (let j = 1; j <= source.length; j++) {
        const substitution = previous[j - 1]! + (intended === source[j - 1] ? 0 : miss);
        current[j] = Math.min(
          substitution,
          previous[j]! + skipIntended,
          current[j - 1]! + insCost[j]!,
        );
      }
    } else {
      for (let j = 1; j <= source.length; j++) {
        const heard = source[j - 1]!;
        const substitution =
          previous[j - 1]! + (intended === heard ? 0 : (row.get(heard) ?? costs.defaultSub));
        current[j] = Math.min(
          substitution,
          previous[j]! + skipIntended,
          current[j - 1]! + insCost[j]!,
        );
      }
    }
    previous = current;
  }

  /*
   * 마지막 행의 최솟값 = haystack의 어느 지점에서 끝나도 되는 경우의 최소 비용.
   * needle 길이로 나누는 것은 한 자모의 최대 비용이 1이기 때문이다 — 비용표가
   * 1을 넘으면 이 값이 음수가 되므로 0에서 자른다.
   */
  const cost = Math.min(...previous);
  return Math.max(0, 1 - cost / target.length);
}

/**
 * 표를 <b>중첩 Map</b>으로 한 번만 옮겨 둔다.
 *
 * <p>처음에는 DP 칸마다 `` costs.subs[`${a}>${b}`] ``로 열쇠를 만들었는데, 그 문자열
 * 하나가 칸마다 새로 생긴다. 메뉴 900개 × 표현 몇 개 × 칸 수백 개면 질의 하나에
 * 문자열 수십만 개다 — 실측에서 이 단계만 <b>10배</b> 느렸다. 값은 같고 비용만 컸다.
 *
 * <p>표는 설정에 실려 다니는 불변 객체이므로 객체 자체를 열쇠로 캐시한다.
 * 배운 것이 하나도 없으면 `null`을 주어 부르는 쪽이 균일 경로로 빠지게 한다.
 */
interface CostTable {
  subs: Map<string, Map<string, number>>;
  ins: Map<string, number>;
  del: Map<string, number>;
}

const tables = new WeakMap<ConfusionCosts, CostTable | null>();

function lookup(costs: ConfusionCosts): CostTable | null {
  const cached = tables.get(costs);
  if (cached !== undefined) return cached;

  const subKeys = Object.keys(costs.subs);
  const empty =
    subKeys.length === 0 &&
    Object.keys(costs.ins).length === 0 &&
    Object.keys(costs.del).length === 0 &&
    costs.defaultSub === 1 &&
    costs.defaultIns === 1 &&
    costs.defaultDel === 1;

  if (empty) {
    tables.set(costs, null);
    return null;
  }

  const subs = new Map<string, Map<string, number>>();
  for (const key of subKeys) {
    const [intended, heard] = key.split(">");
    if (intended === undefined || heard === undefined) continue;
    const row = subs.get(intended) ?? new Map<string, number>();
    row.set(heard, costs.subs[key]!);
    subs.set(intended, row);
  }

  const table: CostTable = {
    subs,
    ins: new Map(Object.entries(costs.ins)),
    del: new Map(Object.entries(costs.del)),
  };
  tables.set(costs, table);
  return table;
}
