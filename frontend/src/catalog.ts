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
 *
 * `path`는 두 단이고, **한 갈래 안에서는 예외 없이 두 단이다.** 한 단만 주면 되묻기의
 * `bestSplit`이 `index.categories()` 폴백과 같은 결과를 내서 얻는 것이 없고, 반대로
 * **반쪽만 두 단으로 주면 더 나쁘다** — `bestSplit`은 그 깊이에 갈래가 없는 메뉴를
 * 나눔에서 빼기 때문에(`reprompt.ts`), 두 단으로 가르는 순간 한 단짜리가 선택지에서
 * 통째로 사라진다.
 *
 * 실제로 그렇게 만들었다가 리허설에서 걸렸다. `이체` 아래에서 `계좌 이체`와
 * `최근 보낸 곳`만 한 단이었더니 "삼촌한테 3만원 보내줘"의 선택지가
 * **"특수 이체 / 자동·예약"** 둘뿐이었다 — 돈을 보내려는 사람에게 그 둘만 내민 것이다.
 * `frontend/test/repromptDoors.test.ts`가 이 불변식을 지킨다.
 *
 * 검색 점수는 안 바뀐다 — `MenuIndex`는 `label`과 `synonyms`만 term으로 넣고
 * `path`는 되묻기의 축과 전체 메뉴의 소제목으로만 쓴다.
 *
 * **`hint`를 여섯 곳에 일부러 비워 두었다.** 빠뜨린 것이 아니니 채우지 말 것.
 *
 *   거래 확인증 · 예약 이체 · 펀드·투자 · 연금 상품 · 이체 한도 변경 · 인증서 관리
 *
 * `AllMenuSheet`는 `!menu.hint && explain`일 때만 "이게 무슨 뜻이에요?" 버튼을 그린다
 * (`AllMenuSheet.tsx`). 25개를 다 채우면 그 버튼이 이 앱에서 한 번도 안 뜬다 —
 * 「이해 지원」 기둥이 화면에서 사라진다는 뜻이다. 그래서 **어려운 말 쪽을 비워 두고
 * 그 자리에서 묻게** 했다. `이체 한도 변경`이 목록에 있는 것은 우연이 아니다.
 * 기획안 §12가 "이름을 모르는 것"으로 지목한 바로 그 메뉴다.
 */
export const CATALOG: MenuCatalog = [
  // ── 조회 ────────────────────────────────────────────────
  {
    id: "inquiry.balance",
    label: "잔액 보기",
    synonyms: ["돈 얼마 있어", "잔고", "통장 확인", "얼마 남았어", "잔액조회"],
    category: "조회",
    path: ["조회", "잔액·계좌"],
    icon: "wallet",
    route: "/inquiry/balance",
    riskLevel: "low",
    hint: "통장에 남은 돈을 봅니다",
  },
  {
    id: "inquiry.history",
    label: "거래 내역",
    synonyms: ["입금 확인", "들어온 돈", "내역 보기", "통장 정리", "거래명세"],
    category: "조회",
    path: ["조회", "들어오고 나간 돈"],
    icon: "list",
    route: "/inquiry/history",
    riskLevel: "low",
    hint: "그동안 들어오고 나간 돈 목록이에요",
  },
  {
    id: "inquiry.deposit",
    label: "입금 예정",
    synonyms: ["연금 언제 들어와", "월급날", "들어올 돈"],
    category: "조회",
    path: ["조회", "들어오고 나간 돈"],
    icon: "calendar",
    route: "/inquiry/deposit",
    riskLevel: "low",
    hint: "앞으로 들어올 돈과 날짜를 봅니다",
  },
  {
    id: "inquiry.accounts",
    label: "내 계좌 모두 보기",
    synonyms: ["통장 목록", "계좌 목록", "통장 몇 개", "계좌 몇 개", "전체 계좌"],
    category: "조회",
    path: ["조회", "잔액·계좌"],
    icon: "doc",
    route: "/inquiry/accounts",
    riskLevel: "low",
    hint: "가지고 있는 통장을 한 번에 봅니다",
  },
  {
    id: "inquiry.statement",
    label: "거래 확인증",
    synonyms: ["영수증", "증명서 떼기", "이체 확인증"],
    category: "조회",
    path: ["조회", "증명서"],
    icon: "doc",
    route: "/inquiry/statement",
    riskLevel: "low",
  },

  // ── 이체 ────────────────────────────────────────────────
  {
    id: "transfer.account",
    label: "계좌 이체",
    // "이체"는 카테고리 수준의 말이라 "자동이체"·"예약이체"에도 들어간다.
    // 그래도 동의어로 두는 이유: 사용자가 "이체해줘"라고만 말하는 일이 흔하고,
    // 그때 계좌 이체가 1순위 후보로 오는 것이 맞다. 더 구체적인 표현을 말하면
    // 포함 범위(coverage) 점수가 그쪽을 위로 올린다.
    // "보내야 해"는 뺐다. 정규화하면 "보내"만 남아 해외 송금·예약 이체까지 다 삼킨다.
    // 목적어 없는 동사는 동의어로 두면 안 된다는 것이 벤치마크에서 드러났다.
    synonyms: ["이체", "돈 보내기", "송금", "부치기", "이체하기", "돈 부쳐"],
    category: "이체",
    path: ["이체", "보내기"],
    icon: "transfer",
    route: "/transfer/account",
    riskLevel: "high",
    hint: "내 통장에서 다른 통장으로 돈을 보냅니다",
  },
  {
    id: "transfer.recent",
    label: "최근 보낸 곳",
    synonyms: ["전에 보낸 사람", "자주 보내는 곳", "지난번 그 계좌"],
    category: "이체",
    path: ["이체", "보내기"],
    icon: "person",
    route: "/transfer/recent",
    riskLevel: "high",
    hint: "전에 돈을 보낸 사람 목록이에요",
  },
  {
    id: "transfer.auto",
    label: "자동이체 관리",
    synonyms: [
      "자동이체",
      "자동이체 해지",
      "매달 나가는 돈",
      "떼가는 거",
      "빠져나가는 돈",
      "자동이체 안 나가게",
    ],
    category: "이체",
    path: ["이체", "자동·예약"],
    icon: "repeat",
    route: "/transfer/auto",
    riskLevel: "high",
    hint: "매달 알아서 나가는 돈을 보고 멈춥니다",
  },
  {
    id: "transfer.reserve",
    label: "예약 이체",
    synonyms: ["나중에 보내기", "날짜 정해서 보내기"],
    category: "이체",
    path: ["이체", "자동·예약"],
    icon: "calendar",
    route: "/transfer/reserve",
    riskLevel: "high",
  },
  {
    id: "transfer.bulk",
    label: "여러 곳 보내기",
    synonyms: ["한번에 보내기", "대량 이체"],
    category: "이체",
    path: ["이체", "특수 이체"],
    icon: "transfer",
    route: "/transfer/bulk",
    riskLevel: "high",
    hint: "여러 사람에게 한 번에 돈을 보냅니다",
  },
  {
    id: "transfer.overseas",
    label: "해외 송금",
    synonyms: ["외국으로 보내기", "달러 보내기"],
    category: "이체",
    path: ["이체", "특수 이체"],
    icon: "globe",
    route: "/transfer/overseas",
    riskLevel: "high",
    hint: "외국에 있는 사람에게 돈을 보냅니다",
  },

  // ── 상품 ────────────────────────────────────────────────
  {
    id: "product.savings",
    label: "예금·적금",
    synonyms: ["적금 들기", "저축", "이자 많은 거"],
    category: "상품",
    path: ["상품", "예금·대출"],
    icon: "savings",
    route: "/product/savings",
    riskLevel: "low",
    hint: "은행에 돈을 맡기고 이자를 받는 것이에요",
  },
  {
    id: "product.loan",
    label: "대출",
    synonyms: ["빌리기", "대출 알아보기", "돈 빌려"],
    category: "상품",
    path: ["상품", "예금·대출"],
    icon: "bank",
    route: "/product/loan",
    riskLevel: "low",
    hint: "은행에서 돈을 빌리는 것이에요",
  },
  {
    id: "product.card",
    label: "카드 신청",
    synonyms: ["체크카드", "카드 만들기"],
    category: "상품",
    path: ["상품", "카드·보험"],
    icon: "card",
    route: "/product/card",
    riskLevel: "low",
    hint: "새 카드를 만들어 달라고 신청합니다",
  },
  {
    id: "product.fund",
    label: "펀드·투자",
    synonyms: ["투자 상품", "펀드 가입"],
    category: "상품",
    path: ["상품", "투자·연금"],
    icon: "chart",
    route: "/product/fund",
    riskLevel: "low",
  },
  {
    id: "product.insurance",
    label: "보험",
    synonyms: ["보험 가입", "보장 상품"],
    category: "상품",
    path: ["상품", "카드·보험"],
    icon: "shield",
    route: "/product/insurance",
    riskLevel: "low",
    hint: "다치거나 아플 때를 대비해 매달 내는 것이에요",
  },
  {
    id: "product.pension",
    label: "연금 상품",
    synonyms: ["노후 준비", "퇴직연금"],
    category: "상품",
    path: ["상품", "투자·연금"],
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
    path: ["설정", "알림·한도"],
    icon: "gauge",
    route: "/settings/limit",
    riskLevel: "high",
  },
  {
    id: "settings.alarm",
    label: "입출금 알림",
    synonyms: ["문자 알림", "알람 설정", "들어오면 알려줘"],
    category: "설정",
    path: ["설정", "알림·한도"],
    icon: "bell",
    route: "/settings/alarm",
    riskLevel: "low",
    hint: "돈이 들어오고 나갈 때 문자로 알려 줍니다",
  },
  {
    id: "settings.profile",
    label: "내 정보",
    synonyms: ["주소 변경", "주소 바꾸기", "전화번호 바꾸기"],
    category: "설정",
    path: ["설정", "내 정보·화면"],
    icon: "person",
    route: "/settings/profile",
    riskLevel: "low",
    hint: "전화번호와 주소 같은 내 정보를 봅니다",
  },
  {
    id: "settings.display",
    label: "화면 설정",
    synonyms: ["글씨 크게", "보기 편하게", "큰 글씨"],
    category: "설정",
    path: ["설정", "내 정보·화면"],
    icon: "gauge",
    route: "/settings/display",
    riskLevel: "low",
    hint: "글씨 크기와 밝기를 바꿉니다",
  },
  {
    id: "support.call",
    label: "전화 상담",
    synonyms: ["상담원", "사람이랑 통화", "물어보기", "도와주세요"],
    category: "설정",
    path: ["설정", "도움"],
    icon: "phone",
    route: "/support/call",
    riskLevel: "low",
    hint: "직원과 전화로 이야기합니다",
  },

  // ── 인증 ────────────────────────────────────────────────
  {
    id: "auth.certificate",
    label: "인증서 관리",
    synonyms: ["공동인증서", "인증서 갱신", "공인인증서"],
    category: "인증",
    path: ["인증"],
    icon: "lock",
    route: "/auth/certificate",
    riskLevel: "high",
  },
  {
    id: "auth.password",
    label: "비밀번호 변경",
    synonyms: ["비번 바꾸기", "비밀번호 바꾸기", "암호 변경"],
    category: "인증",
    path: ["인증"],
    icon: "lock",
    route: "/auth/password",
    riskLevel: "high",
    hint: "지금 쓰는 비밀번호를 새것으로 바꿉니다",
  },
  {
    id: "auth.simple",
    label: "간편 비밀번호",
    synonyms: ["지문 등록", "간편 로그인", "여섯 자리"],
    category: "인증",
    path: ["인증"],
    icon: "shield",
    route: "/auth/simple",
    riskLevel: "high",
    hint: "숫자 여섯 자리로 빠르게 여는 방법이에요",
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
