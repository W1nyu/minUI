import type { ColdStartPresets, MenuCatalog } from "@minui/core";

/**
 * 데모 은행 앱의 메뉴 카탈로그 — 이식 계약 ①.
 *
 * 25개. 실제 국내 은행 앱의 구조를 참고해 조회·이체·상품·설정·인증 다섯 갈래로 짰다.
 * 카드 홈에 뜨는 것은 4개뿐이므로, **나머지 21개가 전체 메뉴와 음성 탐색(M4)의 검증 대상**이다.
 *
 * `synonyms`는 사용자가 실제로 쓰는 말이지 은행이 쓰는 말이 아니다.
 * "자동이체 해지"를 사람들은 "떼가는 거 그만"이라고 부른다 — 이 간극이 §8.3에서
 * 동의어 사전을 임베딩보다 앞에 둔 이유다.
 */
export const CATALOG: MenuCatalog = [
  // ── 조회 ────────────────────────────────────────────────
  {
    id: "inquiry.balance",
    label: "잔액 보기",
    synonyms: ["돈 얼마 있어", "잔고", "통장 확인", "얼마 남았어", "잔액조회"],
    category: "조회",
    icon: "wallet",
    route: "/inquiry/balance",
    riskLevel: "low",
  },
  {
    id: "inquiry.history",
    label: "거래 내역",
    synonyms: ["입금 확인", "들어온 돈", "내역 보기", "통장 정리", "거래명세"],
    category: "조회",
    icon: "list",
    route: "/inquiry/history",
    riskLevel: "low",
  },
  {
    id: "inquiry.deposit",
    label: "입금 예정",
    synonyms: ["연금 언제 들어와", "월급날", "들어올 돈"],
    category: "조회",
    icon: "calendar",
    route: "/inquiry/deposit",
    riskLevel: "low",
  },
  {
    id: "inquiry.accounts",
    label: "내 계좌 모두 보기",
    synonyms: ["통장 목록", "계좌 몇 개", "전체 계좌"],
    category: "조회",
    icon: "doc",
    route: "/inquiry/accounts",
    riskLevel: "low",
  },
  {
    id: "inquiry.statement",
    label: "거래 확인증",
    synonyms: ["영수증", "증명서 떼기", "이체 확인증"],
    category: "조회",
    icon: "doc",
    route: "/inquiry/statement",
    riskLevel: "low",
  },

  // ── 이체 ────────────────────────────────────────────────
  {
    id: "transfer.account",
    label: "계좌 이체",
    synonyms: ["돈 보내기", "송금", "부치기", "이체하기", "돈 부쳐", "보내야 해"],
    category: "이체",
    icon: "transfer",
    route: "/transfer/account",
    riskLevel: "high",
  },
  {
    id: "transfer.recent",
    label: "최근 보낸 곳",
    synonyms: ["전에 보낸 사람", "자주 보내는 곳", "지난번 그 계좌"],
    category: "이체",
    icon: "person",
    route: "/transfer/recent",
    riskLevel: "high",
  },
  {
    id: "transfer.auto",
    label: "자동이체 관리",
    synonyms: [
      "자동이체 해지",
      "매달 나가는 돈",
      "떼가는 거",
      "빠져나가는 돈",
      "자동이체 안 나가게",
    ],
    category: "이체",
    icon: "repeat",
    route: "/transfer/auto",
    riskLevel: "high",
  },
  {
    id: "transfer.reserve",
    label: "예약 이체",
    synonyms: ["나중에 보내기", "날짜 정해서 보내기"],
    category: "이체",
    icon: "calendar",
    route: "/transfer/reserve",
    riskLevel: "high",
  },
  {
    id: "transfer.bulk",
    label: "여러 곳 보내기",
    synonyms: ["한번에 보내기", "대량 이체"],
    category: "이체",
    icon: "transfer",
    route: "/transfer/bulk",
    riskLevel: "high",
  },
  {
    id: "transfer.overseas",
    label: "해외 송금",
    synonyms: ["외국으로 보내기", "달러 보내기"],
    category: "이체",
    icon: "globe",
    route: "/transfer/overseas",
    riskLevel: "high",
  },

  // ── 상품 ────────────────────────────────────────────────
  {
    id: "product.savings",
    label: "예금·적금",
    synonyms: ["적금 들기", "저축", "이자 많은 거"],
    category: "상품",
    icon: "savings",
    route: "/product/savings",
    riskLevel: "low",
  },
  {
    id: "product.loan",
    label: "대출",
    synonyms: ["빌리기", "대출 알아보기", "돈 빌려"],
    category: "상품",
    icon: "bank",
    route: "/product/loan",
    riskLevel: "low",
  },
  {
    id: "product.card",
    label: "카드 신청",
    synonyms: ["체크카드", "카드 만들기"],
    category: "상품",
    icon: "card",
    route: "/product/card",
    riskLevel: "low",
  },
  {
    id: "product.fund",
    label: "펀드·투자",
    synonyms: ["투자 상품", "펀드 가입"],
    category: "상품",
    icon: "chart",
    route: "/product/fund",
    riskLevel: "low",
  },
  {
    id: "product.insurance",
    label: "보험",
    synonyms: ["보험 가입", "보장 상품"],
    category: "상품",
    icon: "shield",
    route: "/product/insurance",
    riskLevel: "low",
  },
  {
    id: "product.pension",
    label: "연금 상품",
    synonyms: ["노후 준비", "퇴직연금"],
    category: "상품",
    icon: "coin",
    route: "/product/pension",
    riskLevel: "low",
  },

  // ── 설정 ────────────────────────────────────────────────
  {
    id: "settings.limit",
    label: "이체 한도 변경",
    synonyms: ["보낼 수 있는 금액", "한도 올리기", "한도 늘려"],
    category: "설정",
    icon: "gauge",
    route: "/settings/limit",
    riskLevel: "high",
  },
  {
    id: "settings.alarm",
    label: "입출금 알림",
    synonyms: ["문자 알림", "알람 설정", "들어오면 알려줘"],
    category: "설정",
    icon: "bell",
    route: "/settings/alarm",
    riskLevel: "low",
  },
  {
    id: "settings.profile",
    label: "내 정보",
    synonyms: ["주소 변경", "전화번호 바꾸기"],
    category: "설정",
    icon: "person",
    route: "/settings/profile",
    riskLevel: "low",
  },
  {
    id: "settings.display",
    label: "화면 설정",
    synonyms: ["글씨 크게", "보기 편하게", "큰 글씨"],
    category: "설정",
    icon: "gauge",
    route: "/settings/display",
    riskLevel: "low",
  },
  {
    id: "support.call",
    label: "전화 상담",
    synonyms: ["상담원", "사람이랑 통화", "물어보기", "도와주세요"],
    category: "설정",
    icon: "phone",
    route: "/support/call",
    riskLevel: "low",
  },

  // ── 인증 ────────────────────────────────────────────────
  {
    id: "auth.certificate",
    label: "인증서 관리",
    synonyms: ["공동인증서", "인증서 갱신", "공인인증서"],
    category: "인증",
    icon: "lock",
    route: "/auth/certificate",
    riskLevel: "high",
  },
  {
    id: "auth.password",
    label: "비밀번호 변경",
    synonyms: ["비번 바꾸기", "암호 변경"],
    category: "인증",
    icon: "lock",
    route: "/auth/password",
    riskLevel: "high",
  },
  {
    id: "auth.simple",
    label: "간편 비밀번호",
    synonyms: ["지문 등록", "간편 로그인", "여섯 자리"],
    category: "인증",
    icon: "shield",
    route: "/auth/simple",
    riskLevel: "high",
  },
];

/**
 * 온보딩 답에 따른 초기 카드 세트 (기획안 F5).
 *
 * `inquiry`는 기획안 §5.1이 페르소나 A(김순자, 73세)에게 그려 보인 네 장
 * — 잔액 보기 / 관리비 보내기 / 입금 내역 / 전화 상담 — 을 그대로 옮긴 것이다.
 */
export const COLD_START_PRESETS: ColdStartPresets = {
  inquiry: ["inquiry.balance", "transfer.account", "inquiry.history", "support.call"],
  transfer: ["transfer.account", "transfer.recent", "inquiry.balance", "transfer.auto"],
  invest: ["product.savings", "product.fund", "inquiry.balance", "inquiry.history"],
};

export const MENU_BY_ID = new Map(CATALOG.map((menu) => [menu.id, menu]));

/** 기본 UI 모드의 메뉴 트리가 쓰는 카테고리 순서. */
export const CATEGORY_ORDER = ["조회", "이체", "상품", "설정", "인증"] as const;
