# MinUI Engine

> 자주 쓰는 기능만 큰 카드로 남기고, 나머지 메뉴는 자연어로 불러내는 **AI 금융 접근성
> 코파일럿이 가능한 이식형 UI 레이어**. 어떤 금융 앱에도 얹을 수 있게 설계하고, 실제 금융사
> 5곳과 데모 은행 앱 위에서 검증한다.

설계·측정·실패 기록이 [`docs/기획안.md`](docs/기획안.md) 한 파일에 있다.

## 빨리 보려면 — MinUI Studio

**금융사 주소를 넣으면 10초 만에 그 회사에 얹힌 쉬운 모드가 뜬다.**

```bash
pnpm install
pnpm --filter demos dev     # → http://localhost:5174/studio
```

주소를 넣으면 전체메뉴를 읽어 카탈로그를 만들고, 첫 화면 카드를 고르고, 미리보기와
이식 코드 두 줄을 보여 준다. 하나은행 10.7초 / KB증권 5.3초에 끝난다.

같은 앱의 `/shinhan` `/kbsec` `/hana`는 미리 만들어 둔 세 곳이다.

> **기본 Studio 경로에는 LLM이 없다.** 수집(Playwright)·조립·첫 화면 넉 장은 결정론이라
> 같은 주소를 넣으면 같은 결과가 나오고, 키가 없어도 완전히 같은 것이 나온다. AI는 이
> 결과를 덮어쓰지 않고 설명·의도 이해·의미 탐색을 보강하는 선택적 capability로 붙는다.
>
> 로컬 검색이 낮은 확신을 내면 원격 의미 검색(`/api/match`)과 LLM 보조(`/api/assist`,
> `/api/explain`)를 선택적으로 쓴다. AI가 없거나 실패해도 후보·전체 메뉴·기본 설명으로
> 돌아가며, 모델이 거래를 자동 실행하지는 않는다.

## 공모전 핵심

MinUI의 AI는 거래를 대신하는 챗봇이 아니다. 사용자의 말에서 목적을 이해해 복잡한 메뉴와
금융 용어를 **이해 가능한 선택지**로 바꾸고, 고위험 행동 직전에는 사용자가 읽고 확인하게
돕는다.

- 의미 탐색: 로컬 검색과 다국어 신경망 검색을 저신뢰에서 결합
- 이해 지원: 어려운 용어와 다음 단계를 짧고 쉬운 말로 설명
- 안전 확인: 구조화된 AI 제안을 메뉴·위험도 규칙으로 다시 검증하고 확인 카드로 제시
- 실패 회복: AI가 모를 때도 후보, 쉬운 재질문, 전체 메뉴로 즉시 이어짐

## 데모 은행 앱 띄우기

거래까지 도는 검증 베드다. 세 가지를 순서대로 켠다.

```bash
pnpm install

# 1. DB
docker compose -f backend/compose.yaml up -d

# 2. 백엔드 (8080) — 처음 뜰 때 데모 데이터를 시드한다
cd backend && ./gradlew bootRun

# 3. 프런트 (5173)
pnpm --filter frontend dev
```

→ http://localhost:5173

**실계좌·마이데이터는 연결하지 않는다.** 백엔드 없이 정적 데모를 열면 브라우저 탭 안의
가상 원장으로, 위 백엔드를 함께 띄우면 `/mock/openbanking/v2.0/*` Mock endpoint로 동작한다.
두 경우 모두 테스트 계좌 6개와 가상 OAuth 표기만 사용한다. 음성/AI는 메뉴와 입력 제안을
도울 뿐, 사용자가 이체 내용을 확인하고 **보내기**를 누르기 전에는 원장을 호출하지 않는다.

Mock은 금융결제원 오픈뱅킹의 잔액조회·핀테크이용번호 기반 입금이체에서 화면에 필요한
JSON 필드와 Bearer 흐름을 본뜬 부분집합이다. 실제 API 호환·OAuth 보안·금융 연동을 주장하지
않는다. 기준은 [금융결제원 잔액조회](https://developers.kftc.or.kr/dev/openapi/open-banking/balance)와 [입금이체](https://developers.kftc.or.kr/dev/openapi/open-banking/deposit)다.

내리기:

```bash
cd backend && ./gradlew --stop
docker compose -f backend/compose.yaml down     # -v 를 붙이면 DB 데이터까지 삭제
```

DB를 비우고 다시 띄우면 데모 데이터가 자동으로 재생성된다.

## 무엇을 보면 되는가

헤더 오른쪽의 **[기본 UI] / [쉬운 모드]** 스위치가 이 데모의 전부다. 두 모드는
**같은 백엔드, 같은 화면 컴포넌트**를 쓰고 UI 레이어만 다르다 — 그래야 비교에서
UI 외의 변수가 통제된다 (기획안 §12.2).

- **쉬운 모드** — 큰 카드 4장. 잔액은 카드에 이미 떠 있어 탭 0회로 읽힌다
- **말로 찾기** — 카드에 없는 21개 메뉴를 구어체로 부른다. "자동이체 안 나가게 해야 하는데"
- **전체 메뉴** — 25개 전부. 여기서 카드를 홈에 고정하거나 글씨 크기를 바꾼다
- **한 번 헤맨 말은 기억한다** — 검색이 못 알아들은 말로 갈래를 타고 끝내 찾아내면,
  그 말이 이 기기에서 그 메뉴의 이름이 된다. 다음부터는 한 번에 나온다
- **말한 순서대로 받는다** — "김미영한테 3만원 송금"이든 "3만원 김미영한테 송금"이든
  같게 받는다. 수취인은 골라 두고 **금액은 채우지 않는다** — 눌러서 넣는 제안으로 둔다
- **왜 이렇게 보이나요?** — 카드 아래 링크. 카드가 왜 그 자리인지 답하고,
  기억해 둔 말을 보여 주고 지운다. 개인화가 조용한 것과 깜깜한 것은 다르다
- **기본 UI** — 대조군. 실제 은행 앱 구조(배너·계좌 카드·아이콘 격자·탭바)를 따랐다
- **화면 도움 맞추기** — 사용자가 허용하면 누름 지연·빠른 되돌아감·음성 대기 시간을
  **탭 안의 합계로만** 보고 완전 단순형/하이브리드 안내형/일반 단순형을 조절한다. 심리적
  "불안도"를 진단하거나 원문·메뉴 ID·계좌 정보·음성을 저장/전송하지 않으며, 기록은 지울 수 있다

음성 버튼은 Chrome에서 마이크 권한을 주면 실제로 동작한다. 권한이 없거나 지원되지
않는 브라우저에서는 같은 화면의 텍스트 입력으로 똑같이 찾을 수 있다.

**음성은 브라우저 Web Speech를 우선 사용한다.** 지원되지 않거나 인식이 불안정하면 같은
화면의 텍스트 검색으로 즉시 이어진다. 무거운 음성 모델을 첫 화면에 싣지 않아, 음성을 쓰지
않는 사용자도 빠르게 시작할 수 있다.

## 구조

```
packages/core     @minui/core    프레임워크 무관 엔진. 의존성 0
packages/react    @minui/react   React 바인딩 + 접근성 디자인 토큰
packages/voice    @minui/voice   STT Provider — Web Speech · 텍스트 검색 전환
frontend                         데모 은행 앱 (두 UI 모드)
backend                          Spring Boot 가상 계정계 + Open Banking Mock (복식부기 원장)
demos                            실제 금융사 5곳 + MinUI Studio
services/harvester               URL → 수집 원본 (Playwright) + 브라우저 스니펫
services/enricher                LLM 연결 — 빌드 타임 보강, 런타임 폴백·뜻풀이
tools                            카탈로그 빌드·벤치마크·리포트
docs                             기획안과 측정 결과
```

호스트 앱이 엔진에 제공할 것은 두 개뿐이다 — 메뉴 카탈로그(JSON)와
메뉴 ID를 받아 화면을 여는 함수. 자세한 계약은 [`packages/core/README.md`](packages/core/README.md).

## 검증

```bash
pnpm test                              # 704 tests
pnpm typecheck
cd backend && ./gradlew test           # Testcontainers 통합 테스트 6종

pnpm --filter tools build:catalog      # 수집 원본 + ai + 사람 → 카탈로그
pnpm --filter tools bench:sites        # 동의어를 누가 붙였을 때 잘 찾는가 (4구성)
pnpm --filter tools bench:search       # 구어체 질의 50건
pnpm --filter tools bench:learning     # 개인 동의어 학습이 나머지를 망치는가
pnpm --filter tools diagnose           # 놓친 질의가 왜 놓쳤는가
pnpm --filter tools tune:threshold     # 임계값 — 정답 세트와 답 없는 세트를 함께
pnpm --filter tools fetch:model        # 임베딩 모델 (bge-m3 560MB, 저장소에 없음)

# 배포에 담아 갈 것을 미리 굽는다. GitHub Pages는 정적이라 런타임 API가 없다.
pnpm --filter tools build:explain-cache   # 뜻풀이 451개 (Gemini 키 필요)
pnpm --filter tools build:studio-samples  # Studio 재생용 3곳 (Chrome 필요)

# 도우미(검색이 못 찾았을 때 부르는 LLM)는 임의 발화라 못 굽는다. 따로 띄운다.
# **없어도 데모는 온전히 돈다** — 되묻기로 내려갈 뿐이고, 시연 대본은 이것에 기대지 않는다.
cd services/assist-worker
pnpm dlx wrangler@3 secret put GOOGLE_API_KEY   # 키는 여기에만 둔다
pnpm dlx wrangler@3 deploy                      # 주소가 나온다
# 그 주소를 저장소 Variables의 ASSIST_URL에 넣으면 다음 배포부터 붙는다.

pnpm --filter @minui/harvester recall  # 자동 수집 회수율 (손 수집본 대비)
pnpm --filter @minui/enricher bench:assist   # 런타임 LLM 폴백의 이득과 손해
```

주요 수치 (2026-08-14)

| | |
|---|---|
| 자동 수집 회수율 | 99% (로그인 불필요 4곳) |
| 검색 — 온디바이스만 | 85% |
| 검색 — LLM 폴백까지 | **95%** |
| 답 없는 질의 100건 | 97건 옳게 거절 |
| 어려운 말 풀이 커버리지 | 86% (2,522/2,948) |
| 개인 동의어 학습이 다른 질의를 망친 건수 | 0건 (64문항) |
| 이식 시간 | 10초 (반나절 → ) |

**이 수치들에는 흠이 있다.** 질의도 내가 쓰고 동의어도 내가 썼다 —
자세한 것은 `docs/기획안.md` §0에 적어 뒀다.

과제 수행 계측은 앱에 켜져 있다. 사용자 테스트 진행자는 콘솔에서 이렇게 쓴다.

```js
minuiMetrics.begin("S1", "transfer.account", "minui")   // 과제 지시 직후
// ... 참가자가 수행 (완료는 자동 감지) ...
copy(minuiMetrics.toJSON())                             // 회수
```

## 읽을 만한 곳

이 프로젝트에서 판단이 담긴 자리들.

| | |
|---|---|
| `packages/core/src/LayoutStabilizer.ts` | 개인화가 화면을 흔들지 않게 하는 네 장치 |
| `packages/core/src/search/voiceAction.ts` | 음성으로 할 수 있는 일의 경계 |
| `packages/core/src/search/LearnedTerms.ts` | 사용자 말을 배우면서 개인정보는 안 배우는 법 |
| `packages/react/src/AdaptationSheet.tsx` | 적응했다는 것을 어떻게 말해 주는가 |
| `packages/core/src/search/slots.ts` | 이름 하나 잘못 고르는 값이 얼마인가 |
| `packages/core/src/contextBoost.ts` | 우연을 주기로 오인하지 않는 법 |
| `backend/.../TransferService.java` | 격리 수준과 락이 각자 맡는 몫 |
| `services/harvester/src/extract.ts` | 다섯 사이트가 서로 다른 방식으로 메뉴를 그린다 |
| `services/enricher/src/prompt.ts` | 모델을 믿지 않고 검증하는 자리 |
| `demos/src/studioRoute.ts` | 링크 하나가 카탈로그가 되는 전 과정 |
| `docs/기획안.md` §16 | 실패하고 되돌린 것들 — 되돌린 이유가 더 쓸모 있다 |
