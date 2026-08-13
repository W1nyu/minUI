import type { MenuId } from "@minui/core";
import { IndexedDbStorageAdapter, MinUIHome, MinUIProvider } from "@minui/react";
import { makeStt, sttPreferenceFromUrl } from "./stt.js";
import { useCallback, useMemo, useState } from "react";
import { makeAssist } from "./assist.js";
import { makeExplain } from "./explain.js";
import { ClassicShell } from "./ClassicShell.js";
import { Studio } from "./Studio.js";
import { StubScreen } from "./StubScreen.js";
import { SITES, findSite, type SiteMeta } from "./sites.js";

type Mode = "minui" | "classic";

/**
 * 실제 금융사 메뉴 위에 MinUI를 얹은 데모.
 *
 * <p>미니은행 데모(`frontend/`)와의 차이는 카탈로그가 <b>내 것이 아니라는</b> 점 하나다.
 * 메뉴 이름도 계층도 카테고리도 사이트가 정한 그대로이고, 나는 손대지 않았다.
 * 그래서 이 앱이 이식성 주장의 실제 시험이 된다.
 */
export function App() {
  // 주소로만 들어간다. 탭 바에 두면 데모의 다섯 사이트와 성격이 섞인다 —
  // Studio는 "아직 없는 사이트를 얹어 보는 곳"이다.
  const [studio, setStudio] = useState(
    () => window.location.pathname.replace(/^\//, "") === "studio",
  );

  const [slug, setSlug] = useState(() => {
    // findSite는 띄우지 않는 곳(COLD_SITES)도 찾는다. 주소를 직접 친 경우를 위해 남겨 둔
    // 통로이고, 탭 바에는 SITES만 나온다.
    const fromPath = window.location.pathname.replace(/^\//, "");
    return findSite(fromPath)?.slug ?? SITES[0]!.slug;
  });
  const site = findSite(slug)!;

  if (studio) {
    return (
      <div className="app app-wide">
        <Studio
          onExit={() => {
            setStudio(false);
            window.history.replaceState(null, "", `/${slug}`);
          }}
        />
      </div>
    );
  }

  return (
    <div className="app" style={{ "--site-accent": site.accent } as React.CSSProperties}>
      <SiteSwitch
        current={site}
        onChange={(next) => {
          setSlug(next);
          window.history.replaceState(null, "", `/${next}`);
        }}
      />
      {/* key를 바꿔 사이트마다 엔진을 새로 만든다. 사이트별로 사용 이력이 섞이면 안 된다. */}
      <SiteDemo key={site.slug} site={site} />
      <button
        type="button"
        className="studio-link"
        onClick={() => {
          setStudio(true);
          window.history.replaceState(null, "", "/studio");
        }}
      >
        + 다른 금융사 얹어 보기
      </button>
    </div>
  );
}

function SiteDemo({ site }: { site: SiteMeta }) {
  const [mode, setMode] = useState<Mode>("minui");
  const [openMenuId, setOpenMenuId] = useState<MenuId | null>(null);

  const storage = useMemo(
    () => new IndexedDbStorageAdapter(`demo-${site.slug}`),
    [site.slug],
  );
  /*
   * 브라우저 Web Speech가 주, 온디바이스 Whisper가 예비 (`stt.ts`).
   * `?stt=whisper`를 붙이면 뒤집힌다 — 두 엔진을 같은 발화로 비교하려면 필요하다.
   */
  const stt = useMemo(
    () => makeStt({ prefer: sttPreferenceFromUrl(window.location.search) }),
    [],
  );
  // 온디바이스가 못 찾았을 때만 부른다. 키는 서버에 있고 여기로 오지 않는다.
  const assist = useMemo(() => makeAssist(site.catalog), [site.catalog]);
  // 카탈로그에 뜻풀이가 없는 메뉴에만 붙는다. 같은 이유로 서버를 거친다.
  const explain = useMemo(() => makeExplain(site.catalog), [site.catalog]);

  // 이식 계약 ② — 호스트가 제공하는 것은 이 함수 하나다.
  const openScreen = useCallback((menuId: MenuId) => setOpenMenuId(menuId), []);

  return (
    <MinUIProvider
      catalog={site.catalog}
      onAction={openScreen}
      storage={storage}
      coldStartPresets={site.presets}
      assist={assist}
      explain={explain}
      /*
       * 이 데모는 배치 안정화를 일부 포기한다.
       *
       * 기본값(liveReorder: false)에서는 많이 누른 메뉴가 카드로 올라오기까지 하루가
       * 걸린다 — 흔들리지 않는 화면이 고령 사용자에게 더 값지다는 P3의 판단이다.
       * 하지만 데모는 몇 분 안에 "쓸수록 내 메뉴가 된다"를 보여야 하므로 켠다.
       * 마진 20%와 "한 번에 한 장"은 그대로라 화면이 통째로 뒤집히지는 않는다.
       */
      config={{ stability: { liveReorder: true } }}
      fallback={<p className="loading">불러오는 중…</p>}
    >
      <header className="bar">
        <div>
          <p className="bar-name">{site.name}</p>
          <p className="bar-source">
            {site.catalog.length.toLocaleString()}개 메뉴 · {site.source}
          </p>
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
          <MinUIHome catalog={site.catalog} stt={stt} />
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

function SiteSwitch({
  current,
  onChange,
}: {
  current: SiteMeta;
  onChange: (slug: string) => void;
}) {
  return (
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
  );
}
