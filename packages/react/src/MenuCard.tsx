import type { MenuItem, RankedCard } from "@minui/core";
import type { ReactNode } from "react";

export interface MenuCardProps {
  menu: MenuItem;
  card: RankedCard;
  /**
   * 카드가 들고 있는 답. 잔액 카드라면 잔액 자체가, 이체 카드라면 수취인이 들어온다.
   * 호스트가 채우는 이유는 엔진이 은행 도메인을 몰라야 하기 때문이다.
   */
  detail?: ReactNode;
  onSelect: () => void;
}

/**
 * 큰 카드 하나.
 *
 * 접근성 요구가 형태를 거의 다 정한다 (기획안 §11.3).
 *   - 터치 영역 최소 88×88dp — CSS의 min-height/min-width로 보장
 *   - 아이콘만 있는 버튼 금지 — 아이콘은 장식이므로 aria-hidden, 이름은 항상 글자에서 온다
 *   - 표식(새로 왔어요/고정)은 점이 아니라 글자 — 알아채게 하는 것이 목적이다
 */
export function MenuCard({ menu, card, detail, onSelect }: MenuCardProps) {
  const marks: ReactNode[] = [];
  if (card.isNew) {
    marks.push(
      <span className="minui-mark" data-kind="new" key="new">
        새로 왔어요
      </span>,
    );
  }
  if (card.pinned) {
    marks.push(
      <span className="minui-mark" data-kind="pinned" key="pinned">
        고정됨
      </span>,
    );
  }

  return (
    <button
      type="button"
      className="minui-card"
      onClick={onSelect}
      data-menu-id={menu.id}
    >
      <span className="minui-card-icon" aria-hidden="true">
        {ICONS[menu.icon] ?? "•"}
      </span>
      <span className="minui-card-label">{menu.label}</span>
      {marks.length > 0 && <span className="minui-marks">{marks}</span>}
      {detail !== undefined && <span className="minui-card-detail">{detail}</span>}
    </button>
  );
}

/**
 * 아이콘 이름 → 글리프. 이미지 대신 문자를 쓰는 이유는 두 가지다.
 *   ① 번들에 아이콘 폰트나 SVG 세트를 넣지 않아도 된다 (§14 번들 크기 리스크)
 *   ② 아이콘은 어차피 aria-hidden이라 의미를 지지 않는다 — 정확도보다 인지 속도가 중요하다
 * 호스트가 자기 아이콘 세트를 쓰려면 이 컴포넌트를 대체하면 된다.
 */
const ICONS: Record<string, string> = {
  wallet: "💳",
  transfer: "💸",
  list: "🧾",
  repeat: "🔁",
  gauge: "🎚️",
  bank: "🏦",
  phone: "📞",
  card: "💳",
  savings: "🐖",
  chart: "📈",
  shield: "🛡️",
  bell: "🔔",
  gift: "🎁",
  doc: "📄",
  person: "🙂",
  lock: "🔒",
  coin: "🪙",
  calendar: "📅",
  globe: "🌐",
  search: "🔎",
};
