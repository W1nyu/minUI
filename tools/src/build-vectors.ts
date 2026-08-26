import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuCatalog } from "@minui/core";
import { menuDocument } from "../../services/matcher/src/document.js";
import { quantizeInt8 } from "../../services/matcher/src/vectors.js";
import { createEncoders } from "../../services/matcher/src/encoder.js";

/**
 * 사이트별 메뉴 벡터를 굽는다 (M11 Task 10).
 *
 * <p><b>빌드 타임 산출물이고, 브라우저 번들에 안 들어간다.</b> 서버(`/api/match`)가 읽는다.
 * 기획안 §8.3이 온디바이스 임베딩을 뺀 근거는 "546KB vs 100MB대"였고 그 판단은 지금도
 * 맞다 — M11이 바꾼 것은 방법이 아니라 <b>자리</b>다. 기기는 여전히 n-gram 색인만 든다.
 *
 * <p>산출물은 gitignore한다. 카탈로그와 모델에서 결정론으로 다시 나오므로 저장소에
 * 둘 이유가 없고, 모델을 바꾸면 통째로 다시 구워야 한다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../demos/src/vectors");
const SITES = ["kbstar", "shinhan", "kbsec", "miraeasset", "kebhana"] as const;

const { encodePassages, meta } = await createEncoders({ modelDir: join(HERE, "../models") });

console.log(`
  메뉴 벡터 굽기 — ${meta.model} (${meta.dim}차원)
  ${"─".repeat(66)}
`);
console.log(`  사이트         메뉴    색인      굽기`);

mkdirSync(OUT, { recursive: true });
let totalMenus = 0;
let totalBytes = 0;

for (const site of SITES) {
  const catalog = JSON.parse(
    readFileSync(join(HERE, `../../demos/src/catalogs/${site}.json`), "utf8"),
  ) as MenuCatalog;
  const overrides = JSON.parse(
    readFileSync(join(HERE, `../catalogs/${site}.overrides.json`), "utf8"),
  ) as Record<string, { synonyms?: string[] }>;

  /*
   * 무엇을 넣는지는 `menuDocument`가 정한다. **`hint`는 안 넣는다** — 모델이 쓴 글이라
   * 넣는 것이 이득인지 재기 전에는 알 수 없고, 재지 않고 넣는 것이 85%→67%를 만든
   * 그 동작이다 (불변 규칙 10).
   */
  const documents = catalog.map((menu) =>
    menuDocument({
      label: menu.label,
      synonyms: overrides[menu.id]?.synonyms,
      path: menu.path,
    }),
  );

  const started = Date.now();
  const vectors = await encodePassages(documents);
  const seconds = (Date.now() - started) / 1000;

  const scale = new Array<number>(catalog.length);
  const data = new Int8Array(catalog.length * meta.dim);
  vectors.forEach((vector, row) => {
    const quantized = quantizeInt8(vector);
    scale[row] = quantized.scale;
    data.set(quantized.data, row * meta.dim);
  });

  writeFileSync(join(OUT, `${site}.bin`), data);
  writeFileSync(
    join(OUT, `${site}.json`),
    JSON.stringify({
      version: 1,
      model: meta.model,
      dim: meta.dim,
      menuIds: catalog.map((menu) => menu.id),
      scale,
    }),
    "utf8",
  );

  const bytes = statSync(join(OUT, `${site}.bin`)).size;
  totalMenus += catalog.length;
  totalBytes += bytes;
  console.log(
    `  ${site.padEnd(13)} ${String(catalog.length).padStart(4)}  ${`${(bytes / 1024).toFixed(0)}KB`.padStart(7)}  ${`${seconds.toFixed(1)}초`.padStart(7)}`,
  );
}

console.log(`
  합계          ${String(totalMenus).padStart(4)}  ${`${(totalBytes / 1024 / 1024).toFixed(1)}MB`.padStart(7)}

  자리   demos/src/vectors/  (gitignore — 카탈로그와 모델에서 다시 나온다)

  ${"─".repeat(66)}
  **이 파일들은 브라우저로 안 간다.** 서버가 읽고, 브라우저는 질의 문자열만 보낸다.
  기기가 드는 것은 여전히 n-gram 색인뿐이다 (§8.3의 546KB).
`);
