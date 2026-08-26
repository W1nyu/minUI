/**
 * 어느 모델을, 어느 문턱으로 쓸 것인가 (M11 Task 15).
 *
 * <h3>이 스크립트가 답하는 것</h3>
 * <b>`scoreFloor`는 고르는 값이 아니라 나오는 값이다.</b> 부정 질의(정답이 없어야 하는
 * 질의)의 최고점 분포를 보고, 그 위에 문턱을 놓는다. 그래서 이 출력의 핵심은 정확도가
 * 아니라 <b>부정최대와 정답최소가 겹치는가</b>이다 — 겹치면 모든 정답을 살리면서 모든
 * 헛소리를 막는 문턱이 <b>존재하지 않는다.</b>
 *
 * <p>부정 질의 20건은 정답 문자열과의 겹침이라는 변수가 없다. 그래서 실제 표현이
 * 많이 들어간 회귀 세트와도 독립적으로 <b>거절 경계</b>를 고를 수 있다.
 *
 * <p>반면 정답 있는 기존 질의 45건은 `lexical-support`가 대부분이다
 * (`report:contamination`: `semantic-focus` 1/75). 그러므로 여기 찍히는 1순위 정확도는
 * 검색 회귀에는 유효하지만 신경망의 <b>추가 이득</b> 결론은 아니다. 그 결론은
 * `bench:neural`이 `semantic-focus`와 제3자 발화에서 사전 등록 게이트로 낸다.
 *
 * <p>모델을 바꾸려면 먼저 받아 둔다: `pnpm --filter tools fetch:model <이름>`
 */

import { readFileSync } from "node:fs";
import { menuDocument } from "../../services/matcher/src/document.js";
import {
  cosineTopK,
  l2normalize,
  quantizeInt8,
  type VectorIndex,
} from "../../services/matcher/src/vectors.js";

const root = new URL("../../", import.meta.url).pathname.replace(/^\//, "");
const { pipeline, env } = await import("@huggingface/transformers");
env.cacheDir = root + "tools/models";
env.allowLocalModels = true;

const SITES = ["kbsec", "shinhan", "kbstar"];
const MODELS: [string, string, string][] = [
  ["Xenova/multilingual-e5-small", "query: ", "passage: "],
  ["Xenova/bge-m3", "", ""],
];

const qs = JSON.parse(readFileSync(`${root}tools/fixtures/site-queries.json`, "utf8")) as
  { sites: Record<string, { query: string; expect: string }[]>; negative: string[] };

for (const [model, qp, pp] of MODELS) {
  const extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
  const enc = async (texts: string[], prefix: string) => {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const b = texts.slice(i, i + 32);
      const r = await extractor(b.map((t) => prefix + t), { pooling: "mean", normalize: true });
      const flat = r.data as Float32Array;
      const dim = r.dims.at(-1)!;
      b.forEach((_, j) => out.push(l2normalize(Float32Array.from(flat.slice(j * dim, (j + 1) * dim)))));
    }
    return out;
  };

  console.log(`\n${"═".repeat(62)}\n  ${model}\n${"═".repeat(62)}`);
  let allNeg: number[] = [];
  let allPosMin: number[] = [];
  let totalCorrect = 0, totalQ = 0;

  for (const site of SITES) {
    const catalog = JSON.parse(readFileSync(`${root}demos/src/catalogs/${site}.json`, "utf8")) as
      { id: string; label: string; path?: string[] }[];
    const ov = JSON.parse(readFileSync(`${root}tools/catalogs/${site}.overrides.json`, "utf8")) as
      Record<string, { synonyms?: string[] }>;

    const docs = catalog.map((m) => menuDocument({ label: m.label, synonyms: ov[m.id]?.synonyms, path: m.path }));
    const t0 = Date.now();
    const vecs = await enc(docs, pp);
    const encodeMs = Date.now() - t0;
    const dim = vecs[0]!.length;
    const scale = new Float32Array(catalog.length);
    const data = new Int8Array(catalog.length * dim);
    vecs.forEach((v, i) => { const q = quantizeInt8(v); scale[i] = q.scale; data.set(q.data, i * dim); });
    const index: VectorIndex = { version: 1, dim, menuIds: catalog.map((m) => m.label), scale, data };

    const t1 = Date.now();
    const negs: number[] = [];
    for (const q of qs.negative) { const [v] = await enc([q], qp); negs.push(cosineTopK(v!, index, 1)[0]!.score); }
    const qMs = (Date.now() - t1) / qs.negative.length;
    negs.sort((a, b) => a - b);

    let correct = 0; const pos: number[] = [];
    for (const c of qs.sites[site] ?? []) {
      const [v] = await enc([c.query], qp);
      const hit = cosineTopK(v!, index, 1)[0]!;
      pos.push(hit.score);
      if (hit.menuId === c.expect) correct++;
    }
    pos.sort((a, b) => a - b);
    totalCorrect += correct; totalQ += pos.length;
    allNeg.push(negs.at(-1)!); allPosMin.push(pos[0]!);

    const gap = pos[Math.floor(pos.length / 2)]! - negs.at(-1)!;
    console.log(
      `  ${site.padEnd(11)} 메뉴 ${String(catalog.length).padStart(3)}개  1순위 ${correct}/${pos.length}` +
      `  | 부정최대 ${negs.at(-1)!.toFixed(3)}  정답최소 ${pos[0]!.toFixed(3)}  정답중앙 ${pos[Math.floor(pos.length/2)]!.toFixed(3)}` +
      `  | 간격 ${gap >= 0 ? "+" : ""}${gap.toFixed(3)}  | 색인 ${((data.length)/1024).toFixed(0)}KB  굽기 ${(encodeMs/1000).toFixed(1)}s  질의 ${qMs.toFixed(0)}ms`,
    );
  }
  console.log(`\n  합계 1순위 ${totalCorrect}/${totalQ} (${Math.round(totalCorrect/totalQ*100)}%)`);
  console.log(`  분포 겹침: 부정최대 ${Math.max(...allNeg).toFixed(3)}  vs  정답최소 ${Math.min(...allPosMin).toFixed(3)}` +
    `  → ${Math.max(...allNeg) < Math.min(...allPosMin) ? "안 겹친다 (문턱이 존재한다)" : "**겹친다 (모든 정답을 살리는 문턱이 없다)**"}`);
}
