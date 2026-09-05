import type { MenuId } from "@minui/core";
import { IndexedDbStorageAdapter, MinUIHome, MinUIProvider } from "@minui/react";
import { makeStt } from "./stt.js";
import type { ReactNode } from "react";
import { Suspense, lazy, useCallback, useId, useMemo, useState } from "react";
import { assistEndpoint, makeAssist } from "@host-ai/assist.js";
import { makeClarify } from "@host-ai/clarify.js";
import { makeCorrect } from "@host-ai/correct.js";
import { makeExplain, makeGroundedHint } from "@host-ai/explain.js";
import { makeRetrieve } from "./match.js";
import { ClassicShell } from "./ClassicShell.js";
import { Studio } from "./Studio.js";
import { StubScreen } from "./StubScreen.js";
import { SITES, findSite, type SiteMeta } from "./sites.js";
import { currentRoute, routeHref } from "./routePath.js";

type Mode = "minui" | "classic";

/**
 * 실제 금융사 메뉴 위에 MinUI를 얹은 데모.
 *
 * <p>미니은행 데모(`frontend/`)와의 차이는 카탈로그가 <b>내 것이 아니라는</b> 점 하나다.
 * 메뉴 이름도 계층도 카테고리도 사이트가 정한 그대로이고, 나는 손대지 않았다.
 * 그래서 이 앱이 이식성 주장의 실제 시험이 된다.
 */
/** 한 번만 읽는다. 빌드 타임에 정해지는 값이다. */
const ASSIST_URL = assistEndpoint();

/**
 * 원격 신경망 검색을 켤 것인가 (M11).
 *
 * <p><b>기본은 꺼짐이다.</b> 사전 등록 게이트를 못 넘었다 — `semantic-focus` 12.4%.
 * 값을 올리려고 네 지렛대를 당겼고 넷 다 측정으로 실패했으며, 원인이 검색기 밖에
 * 있다는 결론이 났다(`진행할것.md` §4). 코드는 한 줄도 안 지웠다.
 *
 * <p>여기서 <b>플래그를 두는 것</b>과 그냥 `enabled: false`로 두는 것은 다르다.
 * 후자면 `retrieve`는 그대로 넘어가고, 정적 배포에는 `/api/match`가 없으므로
 * 저신뢰 검색마다 404를 한 번 받고 버린다. 동작은 옳지만 쓸데없는 요청이다.
 * 플래그가 없으면 <b>아예 안 넘긴다</b> — 그러면 프로덕션 번들에서 호출 경로 자체가
 * 사라진다(`shared/host-ai/assist.ts`가 같은 이유로 같은 모양을 쓴다).
 *
 * <p>로컬에서 켜 보려면:
 * `MINUI_NEURAL=1 VITE_MINUI_NEURAL=1 pnpm --filter demos dev`
 */
const NEURAL = import.meta.env.VITE_MINUI_NEURAL === "1";

/**
 * 음성 코퍼스 수집 화면을 띄울 것인가 (M21). **개발 전용.**
 *
 * <p>`lazy`로 부르는 이유는 `NEURAL` 플래그와 같다 — 플래그가 없으면 이 화면의 코드가
 * <b>프로덕션 번들에 아예 들어가지 않는다.</b> 심사자가 보는 배포물에는 개발 도구가
 * 있을 자리가 없다.
 *
 * <p>켜려면: `MINUI_STT_LAB=1 VITE_MINUI_STT_LAB=1 pnpm --filter demos dev` → `/stt-lab`
 */
const STT_LAB = import.meta.env.VITE_MINUI_STT_LAB === "1";
const SttLab = STT_LAB
  ? lazy(() => import("./SttLab.js").then((module) => ({ default: module.SttLab })))
  : null;

export function App() {
  // 주소로만 들어간다. 탭 바에 두면 데모의 다섯 사이트와 성격이 섞인다 —
  // Studio는 "아직 없는 사이트를 얹어 보는 곳"이다.
  const [studio, setStudio] = useState(
    () => currentRoute() === "studio",
  );
  const [slug, setSlug] = useState(() => {
    // findSite는 띄우지 않는 곳(COLD_SITES)도 찾는다. 주소를 직접 친 경우를 위해 남겨 둔
    // 통로이고, 탭 바에는 SITES만 나온다.
    const fromPath = currentRoute();
    return findSite(fromPath)?.slug ?? SITES[0]!.slug;
  });
  const [demoToolsOpen, setDemoToolsOpen] = useState(false);
  const demoToolsId = useId();
  const site = findSite(slug)!;

  if (SttLab && currentRoute() === "stt-lab") {
    return (
      <Suspense fallback={<p>불러오는 중</p>}>
        <SttLab />
      </Suspense>
    );
  }

  if (studio) {
    return (
      <div className="app app-wide">
        <Studio
          onExit={() => {
            setStudio(false);
            window.history.replaceState(null, "", routeHref(slug));
          }}
        />
      </div>
    );
  }

  return (
    <div className="app" style={{ "--site-accent": site.accent } as React.CSSProperties}>
      <SiteTabs
        current={site}
        onChange={(next) => {
          setSlug(next);
          window.history.replaceState(null, "", routeHref(next));
        }}
        demoTools={
          <ExternalDemoActions
            open={demoToolsOpen}
            menuId={demoToolsId}
            onToggle={() => setDemoToolsOpen((current) => !current)}
            onClose={() => setDemoToolsOpen(false)}
            onOpenStudio={() => {
              setStudio(true);
              window.history.replaceState(null, "", routeHref("studio"));
            }}
          />
        }
      />
      {/* key를 바꿔 사이트마다 엔진을 새로 만든다. 사이트별로 사용 이력이 섞이면 안 된다. */}
      <SiteDemo key={site.slug} site={site} />
    </div>
  );
}

function ExternalDemoActions({
  open,
  menuId,
  onToggle,
  onClose,
  onOpenStudio,
}: {
  open: boolean;
  menuId: string;
  onToggle: () => void;
  onClose: () => void;
  onOpenStudio: () => void;
}) {
  return (
    <nav
      className="external-demo-actions"
      aria-label="시연 도구"
      data-open={open}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        className="external-demo-actions-toggle"
        aria-label={open ? "시연 도구 닫기" : "시연 도구 열기"}
        aria-controls={menuId}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div className="external-demo-actions-list" id={menuId}>
        <a href={routeHref("bank/")}>가상 이체 시연</a>
        <button type="button" hidden data-demo-tool="studio" onClick={onOpenStudio}>
          +다른 금융사 얹어 보기
        </button>
      </div>
    </nav>
  );
}

function SiteDemo({ site }: { site: SiteMeta }) {
  const [mode, setMode] = useState<Mode>("minui");
  const [openMenuId, setOpenMenuId] = useState<MenuId | null>(null);

  const storage = useMemo(
    () => new IndexedDbStorageAdapter(`demo-${site.slug}`),
    [site.slug],
  );
  // 브라우저 Web Speech 하나 (`stt.ts`). 안 되는 브라우저에서는 텍스트 검색이 남는다.
  const stt = useMemo(() => makeStt(), []);
  // 온디바이스가 못 찾았을 때만 부른다. 키는 서버에 있고 여기로 오지 않는다.
  /*
   * 도우미는 **없어도 되는 부품**이다. 중계기 주소가 없으면 만들지 않고, 안 넘긴다 —
   * `VoiceSearchSheet`가 `!assist`에서 바로 갈라지므로 "묻는 중" 상태 자체가 안 생긴다.
   * 살아 있으면 되묻기 화면이 후보로 덮이고, 없으면 되묻기가 그대로 답이다.
   */
  const assist = useMemo(
    () => (ASSIST_URL ? makeAssist(site.catalog, ASSIST_URL) : undefined),
    [site.catalog],
  );
  /*
   * 한 문장 되묻기 (AI-3). 도우미와 같은 규칙 — 중계기가 없으면 만들지 않고 안 넘긴다.
   * 그러면 지금까지의 갈래 되묻기가 그대로 답이 된다.
   */
  const clarify = useMemo(() => makeClarify(), []);
  // 잘못 들린 말 고쳐 쓰기 (AI-6). 사이트마다 메뉴가 달라 카탈로그를 함께 넘긴다.
  const correct = useMemo(() => makeCorrect(site.catalog), [site.catalog]);
  // 카탈로그에 뜻풀이가 없는 메뉴에만 붙는다. 같은 이유로 서버를 거친다.
  const explain = useMemo(() => makeExplain(site.catalog), [site.catalog]);
  // 그 답이 공개 안내문에서 온 것이면 원문 한 줄과 주소를 함께 준다. 대부분은 없다.
  const grounded = useMemo(() => makeGroundedHint(site.catalog), [site.catalog]);
  /*
   * 원격 신경망 검색 (M11). 로컬이 못 찾았을 때만 불린다 — 보내는 것은 질의뿐이고,
   * 벡터도 모델도 서버에만 있다. 꺼져 있으면 지금까지와 바이트 단위로 같게 돈다.
   */
  const retrieve = useMemo(
    () => (NEURAL ? makeRetrieve(site.slug) : undefined),
    [site.slug],
  );

  // 이식 계약 ② — 호스트가 제공하는 것은 이 함수 하나다.
  const openScreen = useCallback((menuId: MenuId) => setOpenMenuId(menuId), []);

  return (
    <MinUIProvider
      catalog={site.catalog}
      onAction={openScreen}
      storage={storage}
      coldStartPresets={site.presets}
      {...(assist ? { assist } : {})}
      {...(clarify ? { clarify } : {})}
      {...(correct ? { correct } : {})}
      explain={explain}
      groundedHint={grounded}
      {...(retrieve ? { retrieve } : {})}
      /*
       * 이 데모는 배치 안정화를 일부 포기한다.
       *
       * 기본값(liveReorder: false)에서는 많이 누른 메뉴가 카드로 올라오기까지 하루가
       * 걸린다 — 흔들리지 않는 화면이 고령 사용자에게 더 값지다는 P3의 판단이다.
       * 하지만 데모는 몇 분 안에 "쓸수록 내 메뉴가 된다"를 보여야 하므로 켠다.
       * 마진 20%와 "한 번에 한 장"은 그대로라 화면이 통째로 뒤집히지는 않는다.
       */
      config={{ stability: { liveReorder: true }, search: { neural: { enabled: NEURAL } } }}
      fallback={<p className="loading">불러오는 중…</p>}
    >
      <header className="bar">
        <div>
          <p className="bar-name">{site.name}</p>
        </div>
        <div className="switch" role="group" aria-label="화면 방식">
          <button
            type="button"
            aria-pressed={mode === "classic"}
            onClick={() => setMode("classic")}
          >
            원래 메뉴
          </button>
          <button
            type="button"
            aria-pressed={mode === "minui"}
            onClick={() => setMode("minui")}
          >
            쉬운 모드
          </button>
        </div>
      </header>

      <main className="body">
        {mode === "minui" ? (
          <MinUIHome catalog={site.catalog} stt={stt} showCardEditor={false} showWhy={false} />
        ) : (
          <ClassicShell site={site} />
        )}
      </main>

      {openMenuId && (
        <StubScreen
          site={site}
          menuId={openMenuId}
          onBack={() => setOpenMenuId(null)}
        />
      )}
    </MinUIProvider>
  );
}

function SiteTabs({
  current,
  onChange,
  demoTools,
}: {
  current: SiteMeta;
  onChange: (slug: string) => void;
  demoTools: ReactNode;
}) {
  return (
    <div className="site-tabs">
      <nav className="sites" aria-label="이식 대상">
        {SITES.map((site) => (
          <button
            key={site.slug}
            type="button"
            aria-current={site.slug === current.slug ? "page" : undefined}
            onClick={() => onChange(site.slug)}
          >
            {site.name}
          </button>
        ))}
      </nav>
      {demoTools}
    </div>
  );
}
