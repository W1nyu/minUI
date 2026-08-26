import type { ColdStartPresets, MenuCatalog, MenuId } from "@minui/core";
import { IndexedDbStorageAdapter, MinUIHome, MinUIProvider } from "@minui/react";
import { WebSpeechSttProvider } from "@minui/voice";
import { useCallback, useMemo, useState } from "react";
import { makeAssist } from "@host-ai/assist.js";
import { runStudio, type StudioResult } from "@host-ai/studio.js";
import { StubScreen } from "./StubScreen.js";
import type { SiteMeta } from "./sites.js";

/**
 * MinUI Studio — 링크 하나로 이식해 본다.
 *
 * <p>이 화면이 있는 이유는 하나다. 지금까지 5개 금융사 카탈로그를 만들면서 한 일은
 * 전부 손이었고, <b>"어떤 금융 앱에도 얹을 수 있다"는 주장이 정작 얹는 일이 수작업이라
 * 증명되지 않았다.</b> 여기서는 주소를 넣으면 몇 초 뒤에 쉬운 모드가 뜬다.
 *
 * <p>마지막 단계에서 이식 코드 두 줄을 보여 준다. 그것이 기획안 §7.2의 계약 전부이고,
 * 보는 사람이 직접 확인하게 하는 것이 이 화면의 목적이다.
 */

const EXAMPLES = [
  { label: "하나은행", url: "https://www.kebhana.com/" },
  { label: "신한은행", url: "https://www.shinhan.com/index.jsp" },
  { label: "KB증권", url: "https://www.kbsec.com/go.able" },
];

export function Studio({ onExit }: { onExit: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudioResult | null>(null);
  /** 재생 중 끝난 단계. 진행이 눈에 보여야 "10초 만에"가 10초로 느껴진다. */
  const [done, setDone] = useState<string[]>([]);

  /*
   * 배포(GitHub Pages)에는 수집기가 없다. 미리 구워 둔 세 곳은 같은 단계·같은 시간으로
   * 재생하고, 그 밖의 주소는 로컬 dev의 `/api/studio`가 있으면 그쪽이 답한다
   * (`shared/host-ai/studio.ts`).
   */
  async function run(target: string) {
    if (target.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setDone([]);

    const outcome = await runStudio(target, {
      onStep: (step) => setDone((steps) => [...steps, step.name]),
    });

    if ("error" in outcome) setError(outcome.error);
    else setResult(outcome.result);
    setBusy(false);
  }

  return (
    <div className="studio">
      <header className="studio-head">
        <div>
          <h1>MinUI Studio</h1>
          <p>금융사 주소를 넣으면 메뉴를 읽어 쉬운 모드를 만들어 봅니다.</p>
        </div>
        <button type="button" className="studio-exit" onClick={onExit}>
          데모로 돌아가기
        </button>
      </header>

      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(url);
        }}
      >
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.kebhana.com/"
          aria-label="금융사 주소"
          disabled={busy}
        />
        <button type="submit" disabled={busy || url.trim().length === 0}>
          {busy ? "읽는 중…" : "이식해 보기"}
        </button>
      </form>

      <p className="studio-examples">
        예시:{" "}
        {EXAMPLES.map((example) => (
          <button
            key={example.url}
            type="button"
            onClick={() => {
              setUrl(example.url);
              void run(example.url);
            }}
            disabled={busy}
          >
            {example.label}
          </button>
        ))}
      </p>

      {busy && (
        <p className="studio-note" role="status">
          전체메뉴를 찾아 여는 중입니다. 사이트에 따라 10초쯤 걸립니다.
          {done.length > 0 && <> — {done.join(" · ")} 끝</>}
        </p>
      )}

      {error && (
        <p className="studio-error">
          {error}
          <br />
          <small>
            로그인해야 보이는 메뉴는 서버가 읽지 못합니다. 그때는 브라우저 스니펫을
            씁니다 — `services/harvester/out/harvest-snippet.js`
          </small>
        </p>
      )}

      {result && <StudioResultView result={result} />}
    </div>
  );
}

function StudioResultView({ result }: { result: StudioResult }) {
  const [openMenuId, setOpenMenuId] = useState<MenuId | null>(null);

  const storage = useMemo(
    () => new IndexedDbStorageAdapter(`studio-${result.site}-${Date.now()}`),
    [result.site],
  );
  const stt = useMemo(() => new WebSpeechSttProvider(), []);
  const assist = useMemo(() => makeAssist(result.catalog), [result.catalog]);
  const openScreen = useCallback((menuId: MenuId) => setOpenMenuId(menuId), []);

  const site: SiteMeta = {
    slug: result.site,
    name: result.host,
    kind: "은행",
    accent: "#2f6f68",
    catalog: result.catalog,
    /*
     * Studio는 방금 수집한 사이트라 **구워 둔 벡터가 없다.** 그래서 원격 검색이 빠지고
     * 로컬만 돈다 — 그것이 맞는 동작이다. 벡터는 빌드 타임 산출물이고, 10초 만에 얹는
     * 경로에 모델 추론을 끼우면 그 10초가 아니게 된다.
     */
    catalogId: result.site,
    presets: result.presets,
    source: `${result.host} 자동 수집`,
  };

  const download = () => {
    const blob = new Blob(
      [`${JSON.stringify({ catalog: result.catalog, presets: result.presets }, null, 2)}\n`],
      { type: "application/json" },
    );
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${result.site}.catalog.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 3000);
  };

  return (
    <div className="studio-result">
      <ol className="studio-steps">
        {result.steps.map((step) => (
          <li key={step.name}>
            <strong>{step.name}</strong> {step.detail}
            <span>{(step.ms / 1000).toFixed(1)}초</span>
          </li>
        ))}
      </ol>

      <dl className="studio-stats">
        <div>
          <dt>메뉴</dt>
          <dd>{result.stats.menus.toLocaleString()}</dd>
        </div>
        <div>
          <dt>갈래 포함</dt>
          <dd>{result.stats.branches}</dd>
        </div>
        <div>
          <dt>이름 겹쳐 뺌</dt>
          <dd>{result.stats.duplicateLabels}</dd>
        </div>
        <div>
          <dt>확인 필요(high)</dt>
          <dd>{result.stats.highRisk}</dd>
        </div>
        <div>
          {/* 코드형 id가 많을수록 사이트 개편에 덜 끊어진다. */}
          <dt>안정적인 id</dt>
          <dd>
            {result.stats.harvested > 0
              ? `${Math.round((result.stats.codedIds / result.stats.harvested) * 100)}%`
              : "—"}
          </dd>
        </div>
      </dl>

      {result.problems.length > 0 && (
        <p className="studio-error">
          검증에 걸린 것 {result.problems.length}건 — {result.problems[0]}
        </p>
      )}

      <div className="studio-preview">
        <div className="studio-phone">
          <MinUIProvider
            key={result.site}
            catalog={result.catalog}
            onAction={openScreen}
            storage={storage}
            coldStartPresets={result.presets}
            assist={assist}
            config={{ stability: { liveReorder: true } }}
            fallback={<p className="loading">불러오는 중…</p>}
          >
            <MinUIHome catalog={result.catalog} stt={stt} />
            {openMenuId && (
              <StubScreen
                site={site}
                menuId={openMenuId}
                onBack={() => setOpenMenuId(null)}
              />
            )}
          </MinUIProvider>
        </div>

        <div className="studio-handoff">
          <h2>당신 앱에 붙이는 데 필요한 전부</h2>
          <pre>{`<MinUIProvider catalog={catalog} onAction={openScreen}>
  <MinUIHome />
</MinUIProvider>`}</pre>
          <p>
            호스트가 주는 것은 <strong>카탈로그(JSON)</strong>와{" "}
            <strong>화면을 여는 함수</strong> 둘뿐입니다. 인증·세션·라우팅은 넘기지
            않습니다.
          </p>
          <button type="button" className="primary" onClick={download}>
            카탈로그 내려받기
          </button>
        </div>
      </div>
    </div>
  );
}
