import type { MenuId } from "@minui/core";
import { useMinUI } from "@minui/react";
import { useEffect } from "react";
import type { SiteMeta } from "./sites.js";

/**
 * 스텁 화면.
 *
 * <p>실제 사이트의 화면을 흉내 내지 않는다. 검증 대상은 **메뉴에 도달하는 과정**이지
 * 도착한 화면이 아니다 — 거래 처리는 M1의 미니은행에서 이미 검증했다.
 *
 * <p>화면이 열리면 작업 완료로 기록한다. 그래야 랭킹이 실제 사용을 반영한다.
 */
export function StubScreen({
  site,
  menuId,
  onBack,
}: {
  site: SiteMeta;
  menuId: MenuId;
  onBack: () => void;
}) {
  const { complete } = useMinUI();
  const menu = site.catalog.find((m) => m.id === menuId);

  useEffect(() => {
    complete(menuId);
  }, [complete, menuId]);

  return (
    <div className="screen" role="dialog" aria-modal="true" aria-label={menu?.label ?? "화면"}>
      <div className="screen-head">
        <button type="button" className="screen-back" onClick={onBack}>
          <span aria-hidden="true">←</span> 뒤로
        </button>
        <h2>{menu?.label}</h2>
      </div>
      <div className="screen-body">
        <dl className="meta">
          <dt>사이트</dt>
          <dd>{site.name}</dd>
          <dt>갈래</dt>
          <dd>{menu?.category}</dd>
          <dt>위험도</dt>
          <dd>
            {menu?.riskLevel === "high"
              ? "high — 음성만으로 실행되지 않습니다"
              : "low"}
          </dd>
          <dt>메뉴 id</dt>
          <dd className="mono">{menu?.id}</dd>
          {menu?.synonyms && menu.synonyms.length > 0 && (
            <>
              <dt>이 말로도 찾힙니다</dt>
              <dd>{menu.synonyms.join(" · ")}</dd>
            </>
          )}
        </dl>
        <p className="notice">
          실제 화면은 만들지 않았습니다. 이 데모가 확인하는 것은 카드 배치와 검색이
          실제 금융사 메뉴 위에서도 그대로 동작하는가입니다.
        </p>
        <button type="button" className="primary" onClick={onBack}>
          돌아가기
        </button>
      </div>
    </div>
  );
}
