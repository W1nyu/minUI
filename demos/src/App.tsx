import type { MenuId } from "@minui/core";
import { IndexedDbStorageAdapter, MinUIHome, MinUIProvider } from "@minui/react";
import { WebSpeechSttProvider } from "@minui/voice";
import { useCallback, useMemo, useState } from "react";
import { ClassicShell } from "./ClassicShell.js";
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
  const [slug, setSlug] = useState(() => {
    const fromPath = window.location.pathname.replace(/^\//, "");
    return findSite(fromPath)?.slug ?? SITES[0]!.slug;
  });
  const site = findSite(slug)!;

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
  const stt = useMemo(() => new WebSpeechSttProvider(), []);

  // 이식 계약 ② — 호스트가 제공하는 것은 이 함수 하나다.
  const openScreen = useCallback((menuId: MenuId) => setOpenMenuId(menuId), []);

  return (
    <MinUIProvider
      catalog={site.catalog}
      onAction={openScreen}
      storage={storage}
      coldStartPresets={site.presets}
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
          <ClassicShell site={site} onOpen={openScreen} />
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
