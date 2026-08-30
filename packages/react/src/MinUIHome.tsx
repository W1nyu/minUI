import type { MenuCatalog, MenuId } from "@minui/core";
import { useRef, useState, type ReactNode } from "react";
import { AdaptationSheet } from "./AdaptationSheet.js";
import { AllMenuSheet } from "./AllMenuSheet.js";
import { HomeCardEditor } from "./HomeCardEditor.js";
import { MenuCard } from "./MenuCard.js";
import { VoiceSearchSheet, type SttLike } from "./VoiceSearchSheet.js";
import { useMinUI } from "./useMinUI.js";
import type { MinUIInteraction } from "./interaction.js";

export interface MinUIHomeProps {
  catalog: MenuCatalog;
  /** 카드가 들고 있을 답. 호스트가 채운다 — 엔진은 은행 도메인을 모른다. */
  renderCardDetail?: (menuId: MenuId) => ReactNode;
  /** 카드 격자 위에 놓일 것 (인사말 등). */
  header?: ReactNode;
  /**
   * 음성 입력 Provider. 주면 하단에 "말로 찾기" 버튼이 생긴다.
   * 주지 않아도 전체 메뉴로 모든 기능에 도달할 수 있다 (원칙 P2).
   */
  stt?: SttLike;
  /**
   * 정보 밀도. 판단은 호스트가 하고 이 컴포넌트는 표현만 바꾼다.
   *
   * <p>없으면 현재와 같은 하이브리드 안내형이다. 엔진의 카드 순서·검색·위험도에는
   * 영향을 주지 않는다.
   */
  supportLevel?: "simple" | "guided" | "standard";
  /** 호스트가 명시적으로 요청했을 때만 주는 기기 안 상호작용 요약. */
  onInteraction?: (interaction: MinUIInteraction) => void;
}

/**
 * 카드 홈 화면.
 *
 * 이 컴포넌트가 하지 않는 일이 중요하다 — 점수를 계산하지 않고, 카드를 정렬하지 않고,
 * 무엇을 보여줄지 고르지 않는다. 전부 엔진이 이미 정한 것을 그리기만 한다.
 * 여기서 한 번이라도 정렬하면 "자리를 지킨다"는 규칙이 UI 레이어에서 깨진다.
 */
export function MinUIHome({
  catalog,
  renderCardDetail,
  header,
  stt,
  supportLevel = "guided",
  onInteraction,
}: MinUIHomeProps) {
  const { cards, open } = useMinUI();
  const [sheet, setSheet] = useState<"none" | "menus" | "search" | "why" | "cards">("none");
  const pressStartedAt = useRef<number | null>(null);

  const byId = new Map(catalog.map((menu) => [menu.id, menu]));
  const visible = cards.filter((card) => byId.has(card.menuId));

  const timestamp = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const notePress = () => {
    const started = pressStartedAt.current;
    pressStartedAt.current = null;
    onInteraction?.({ kind: "press", ...(started === null ? {} : { durationMs: timestamp() - started }) });
  };

  return (
    <div
      className="minui-root"
      data-support-level={supportLevel}
      onPointerDownCapture={() => {
        pressStartedAt.current = timestamp();
      }}
    >
      {header}

      <div className="minui-home" data-count={visible.length}>
        {visible.map((card) => {
          const menu = byId.get(card.menuId)!;
          const detail = renderCardDetail?.(card.menuId);
          return (
            <MenuCard
              key={card.menuId}
              menu={menu}
              card={card}
              {...(detail !== undefined && detail !== null ? { detail } : {})}
              onSelect={() => {
                notePress();
                open(card.menuId);
              }}
            />
          );
        })}
      </div>

      {/*
        카드에 없는 기능으로 가는 길은 항상 여기 두 개뿐이다. 원칙 P2가 말하는
        "감추는 게 아니라 불러내는 것"이 화면에서는 이 고정된 자리로 나타난다.
      */}
      <div className="minui-dock">
        <button
          type="button"
          className="minui-dock-button"
          onClick={() => {
            notePress();
            setSheet("search");
          }}
        >
          <span aria-hidden="true">🎤</span> 말로 찾기
        </button>
        <button
          type="button"
          className="minui-dock-button"
          data-variant="quiet"
          onClick={() => {
            notePress();
            setSheet("menus");
          }}
        >
          <span aria-hidden="true">☰</span> 전체 메뉴
        </button>
      </div>

      {/*
        설명으로 가는 길. **나가는 길 두 개와 나란히 두지 않는다** — 저 둘은 기능에
        도달하는 통로이고 이것은 물어보는 자리다. 같은 크기로 놓으면 홈에 큰 버튼이
        셋이 되어 원칙 P1이 흔들린다.
      */}
      <div className="minui-quiet-actions">
        <button
          type="button"
          className="minui-quiet-link"
          onClick={() => {
            notePress();
            setSheet("cards");
          }}
        >
          홈 카드 고르기
        </button>
        <button
          type="button"
          className="minui-quiet-link"
          onClick={() => {
            notePress();
            setSheet("why");
          }}
        >
          왜 이렇게 보이나요?
        </button>
      </div>

      {sheet === "why" && (
        <AdaptationSheet catalog={catalog} onClose={() => setSheet("none")} />
      )}

      {sheet === "cards" && (
        <HomeCardEditor catalog={catalog} onClose={() => setSheet("none")} />
      )}

      {sheet === "menus" && (
        <AllMenuSheet
          catalog={catalog}
          onClose={() => setSheet("none")}
          onSelect={(menuId) => {
            setSheet("none");
            notePress();
            open(menuId);
          }}
        />
      )}

      {sheet === "search" && (
        <VoiceSearchSheet
          catalog={catalog}
          onClose={() => setSheet("none")}
          onSelect={(menuId, prefill) => {
            setSheet("none");
            notePress();
            open(menuId, prefill);
          }}
          {...(stt ? { stt } : {})}
          {...(onInteraction ? { onInteraction } : {})}
          onBrowseAll={() => setSheet("menus")}
        />
      )}
    </div>
  );
}
