import { useMinUI } from "@minui/react";
import { useState } from "react";
import { CATALOG, CATEGORY_ORDER } from "../catalog.js";
import { useBank } from "../BankContext.js";
import { formatWon } from "../screens/ScreenFrame.js";

type Tab = "home" | "menu";

/**
 * 기본 UI 모드 — 비교 측정의 대조군.
 *
 * 실제 국내 은행 앱의 구조를 그대로 따랐다: 상단 배너, 계좌 요약, 작은 아이콘 격자,
 * 하단 탭바, 그리고 카테고리 아코디언으로 들어가는 전체 메뉴.
 *
 * **일부러 못 만들지 않았다.** 대조군을 나쁘게 만들면 §12의 비교 수치가 의미를 잃는다.
 * MinUI가 줄이는 것은 화면의 품질 차이가 아니라 *단계 수*이고, 그것만 정직하게 드러나야 한다.
 */
export function ClassicShell() {
  const { open } = useMinUI();
  const { accounts, deposits } = useBank();
  const [tab, setTab] = useState<Tab>("home");
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const primary = accounts[0];
  const quickMenus = CATALOG.slice(0, 8);

  return (
    <div className="classic">
      {tab === "home" ? (
        <div className="classic-body">
          <div className="classic-banner">
            <span className="classic-banner-tag">이벤트</span>
            주택청약 신규 가입하고 커피 쿠폰 받으세요
          </div>

          {/*
            계좌 영역에 이름을 붙인다. 하단 탭바에도 "이체" 버튼이 있어, 이름이 없으면
            스크린리더 사용자에게 두 버튼이 똑같이 들린다. 실제 은행 앱이 흔히 놓치는 지점이다.
          */}
          <section className="classic-account" aria-labelledby="classic-account-name">
            <h2 className="classic-account-name" id="classic-account-name">
              {primary?.nickname ?? "계좌"}
            </h2>
            <p className="classic-account-number">{primary?.number}</p>
            <p className="classic-account-balance">
              {primary ? formatWon(primary.balance) : "—"}
            </p>
            <div className="classic-account-actions">
              <button type="button" onClick={() => open("transfer.account")}>
                이체
              </button>
              <button type="button" onClick={() => open("inquiry.history")}>
                거래내역
              </button>
            </div>
          </section>

          <section className="classic-quick">
            <h3 className="classic-section-title">자주 찾는 메뉴</h3>
            <ul className="classic-quick-grid">
              {quickMenus.map((menu) => (
                <li key={menu.id}>
                  <button type="button" onClick={() => open(menu.id)}>
                    {menu.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {deposits.length > 0 && (
            <section className="classic-notice">
              <h3 className="classic-section-title">알림</h3>
              <p>
                {deposits[0]!.label} {formatWon(deposits[0]!.amount)} 입금 예정
              </p>
            </section>
          )}
        </div>
      ) : (
        <section className="classic-body" aria-label="전체 메뉴">
          <h2 className="classic-section-title">전체 메뉴</h2>
          {CATEGORY_ORDER.map((category) => {
            const menus = CATALOG.filter((menu) => menu.category === category);
            const expanded = openCategory === category;
            return (
              <section className="classic-category" key={category}>
                <h3>
                  <button
                    type="button"
                    className="classic-category-toggle"
                    aria-expanded={expanded}
                    onClick={() => setOpenCategory(expanded ? null : category)}
                  >
                    {category}
                    <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
                  </button>
                </h3>
                {expanded && (
                  <ul className="classic-category-list">
                    {menus.map((menu) => (
                      <li key={menu.id}>
                        <button type="button" onClick={() => open(menu.id)}>
                          {menu.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </section>
      )}

      <nav className="classic-tabbar" aria-label="주요 메뉴">
        <button
          type="button"
          aria-current={tab === "home" ? "page" : undefined}
          onClick={() => setTab("home")}
        >
          홈
        </button>
        <button type="button" onClick={() => open("inquiry.accounts")}>
          조회
        </button>
        <button type="button" onClick={() => open("transfer.account")}>
          이체
        </button>
        <button type="button" onClick={() => open("product.savings")}>
          상품
        </button>
        <button
          type="button"
          aria-current={tab === "menu" ? "page" : undefined}
          onClick={() => setTab("menu")}
        >
          전체
        </button>
      </nav>
    </div>
  );
}
