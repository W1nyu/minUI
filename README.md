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
> `/api/explain`)를 **선택적으로** 쓸 수 있다. AI가 없거나 실패해도 후보·전체 메뉴·기본
> 설명으로 돌아가며, 모델이 거래를 자동 실행하지는 않는다.
>
> **공개 배포(GitHub Pages)에서는 그 셋이 다 꺼져 있다.** 아래 「공개 배포에서 도는 것」을
> 볼 것 — 이 문서의 능력 설명은 <b>전체 구성</b>을 말하고, 공개 데모는 그 부분집합이다.

## 공모전 핵심

MinUI의 AI는 거래를 대신하는 챗봇이 아니다. 사용자의 말에서 목적을 이해해 복잡한 메뉴와
금융 용어를 **이해 가능한 선택지**로 바꾸고, 고위험 행동 직전에는 사용자가 읽고 확인하게
돕는다.

- 의미 탐색: 기기 안의 검색(n-gram·자모 보정·개인 동의어). 원격 의미 검색은 코드에 있으나
  **측정으로 채택되지 않아 꺼져 있다**
- 이해 지원: 어려운 용어와 다음 단계를 짧고 쉬운 말로 설명 — **미리 구워 둔 432개**와
  카탈로그에서 계산하는 다음 단계
- 안전 확인: 구조화된 AI 제안을 메뉴·위험도 규칙으로 **다시 검증**하고 확인 카드로 제시
  (`validateProposal`). 검증기는 모델 없이도 돌고, 테스트가 그것을 잰다
- 실패 회복: AI가 모를 때도 후보, 쉬운 재질문, 전체 메뉴로 즉시 이어짐

### 공개 배포에서 도는 것 / 안 도는 것

`https://w1nyu.github.io/minUI/`는 정적 호스팅이라 `/api/*`가 없다. AI는 따로 띄운
중계기(`services/assist-worker`)가 대신 받는다 — **주소를 넣었을 때만.**

| | 공개 배포 | + 중계기 | 로컬 전체 구성 |
|---|---|---|---|
| 기기 안 검색 (n-gram·자모·학습) | ✅ | ✅ | ✅ |
| 어려운 말 풀이 | ✅ 미리 구워 둔 451개 | ✅ + 없는 것은 그 자리에서 | ✅ |
| 다음 단계 안내 · 지금 하실 일 | ✅ 카탈로그에서 계산 | ✅ | ✅ |
| 보내기 전 안심 점검 (F13) | ✅ 결정론 규칙 여섯 | ✅ | ✅ |
| 연습 모드 (F14) | ✅ | ✅ | ✅ |
| 읽어 주기 · 고대비 (F16·F17) | ✅ 브라우저 API | ✅ | ✅ |
| 이번 달 요약 (F19) | ✅ 원장에서 집계 | ✅ | ✅ |
| 제안 검증 (`validateProposal`) | ✅ | ✅ 화면에 표시 | ✅ |
| 가상 이체 (원장이 실제로 바뀜) | ✅ 브라우저 안 | ✅ | ✅ Spring + Postgres |
| LLM 도우미 (`/assist`) | ❌ 되묻기로 내려감 | ✅ | ✅ |
| 한 문장 되묻기 (`/clarify`) | ❌ 갈래 되묻기로 | ✅ | ✅ |
| 확인 문장 뼈대 (`/confirm`) | ❌ 고정 문구로 | ✅ | ✅ |
| 점검마다 할 일 (`/safety`) | ❌ 걸린 것만 보임 | ✅ | ✅ |
| 잘못 들린 말 교정 (`/correct`) | ❌ 들린 그대로 찾음 | ✅ | ✅ |
| 원격 의미 검색 (`/api/match`) | ❌ 꺼짐 | ❌ 꺼짐 | 플래그로 켬 |
| Studio 실시간 수집 | ❌ 3곳 재생 | ❌ | ✅ Playwright |

**없는 것이 고장으로 보이지 않게 만들어 뒀다.** 중계기 주소가 없으면 `assist`·`clarify`를
아예 안 넘겨 "묻는 중" 상태가 생기지 않고, 되묻기와 고정 문구가 그대로 답이 된다 —
그것이 「실패 회복」이다. 중계기 주소는 번들에 들어가지도 않는다 — 주소를 안 준
빌드에서 그 호스트 문자열은 **0건**이다(2026-08-30 실측).
`services/smoke`가 배포된 주소에서 이 여섯 가지를 실제로 밟아 확인한다.

**AI가 값을 만들지 못한다.** 확인 문장은 모델이 뼈대만 쓰고 앱이 값을 채운다 —
`{받는분}님께 {금액}을 보냅니다`에서 이름과 금액은 화면의 것이다. 모델이 쓴 글에 숫자가
있으면 뼈대가 통째로 버려지고, 보내는 요청에도 수취인·금액·계좌번호가 담기지 않는다.

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
- **이렇게 들었어요** — 잘못 들린 말을 고쳐 다시 찾는다. `가동 이제 막아줘` →
  `자동이체 그만하게 해줘`. **고친 말을 보여 준다** — 목적지를 모델이 고르지 않으므로
  사용자가 맞는지 확인할 수 있다 (중계기가 있을 때)
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
- **보내기 전에 확인해 주세요** — 처음 보내는 분, 평소보다 큰 금액, 방금 같은 곳에 같은
  금액, 같은 이름의 받는 분, 늦은 밤, 남는 잔액. 여섯 가지를 결정론 규칙으로 본다.
  **막지 않는다** — 확인 표시를 하나 더 받을 뿐이고 겁을 주지도 않는다
- **연습해 보기** — 끝까지 해 보되 아무것도 움직이지 않는다. 가상 원장조차 안 건드린다
- **읽어 주기** — 확인 화면과 이번 달 요약을 소리로. 계좌번호는 끝 네 자리만 읽는다 —
  화면은 혼자 보지만 소리는 옆 사람도 듣는다
- **진하게** — 전체 메뉴 안, 글씨 크기 바로 아래. 색만 바뀌고 배치는 그대로다
- **이번 달 요약** — 거래 내역 맨 위 두 문장. 스무 줄을 훑어 스스로 더하지 않아도 된다
- **AI 도우미 끄고 보기** — 시연 중에 누르면 중계기가 꺼지고 **같은 질의**가 되묻기로
  내려간다. 끄는 것은 중계기이지 기기 안의 것이 아니다 — 로컬 검색·구워 둔 뜻풀이·안심
  점검은 그대로 돈다
- **[AI가 못 하는 것](https://w1nyu.github.io/minUI/guard)** — `validateProposal`을 화면에서
  직접 돌린다. 없는 메뉴·숫자 든 설명·**위험도를 낮추려는 시도**를 넣어 보고 무엇이
  막히는지 본다. 모델을 안 부르므로 인터넷 없이 돌고 같은 입력에 늘 같은 답을 낸다

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

# 공개 안내문을 받아 뜻풀이의 근거로 쓴다. robots.txt를 지키고, 받은 본문은
# 저장소에 넣지 않는다(.gitignore) — 배포에 담기는 것은 인용한 문장 몇 줄뿐이다.
pnpm --filter @minui/harvester docs -- https://www.kebhana.com/ kebhana  # 문서 156개
pnpm --filter tools link:docs             # 메뉴에 문서 붙이기 — 붙는 것은 9개(1.5%)

# 배포에 담아 갈 것을 미리 굽는다. GitHub Pages는 정적이라 런타임 API가 없다.
pnpm --filter tools build:explain-cache   # 뜻풀이 451개 + 근거 있는 뜻풀이 7개 (Gemini 키 필요)
pnpm --filter tools build:studio-samples  # Studio 재생용 3곳 (Chrome 필요)

# AI 중계기 — 임의 발화를 받아야 하는 여섯은 못 굽는다. 따로 띄운다.
#   /assist 후보 고르기 · /explain 캐시 밖 뜻풀이 · /clarify 한 문장 되묻기
#   /confirm 확인 문장 뼈대 · /safety 점검마다 할 일 · /correct 잘못 들린 말 교정
# **없어도 데모는 온전히 돈다** — 되묻기와 고정 문구로 내려갈 뿐이고, 대본은 이것에 기대지 않는다.
cd services/assist-worker
pnpm dlx wrangler@3 secret put GOOGLE_API_KEY     # 키는 여기에만 둔다
pnpm dlx wrangler@3 secret put OPENAI_COMPAT_API_KEY   # 두 번째 공급자 (선택)
# 두 번째 자리는 **벤더를 고르지 않는다.** /chat/completions를 받는 곳이면 무엇이든
# 되고, wrangler.toml의 OPENAI_COMPAT_BASE_URL·MODEL까지 셋이 다 있어야 쓴다.
# 안 넣으면 Gemini 하나로 돌고, 그것으로 충분하다.
pnpm dlx wrangler@3 deploy                        # 주소가 나온다
# 그 주소를 저장소 Variables의 ASSIST_URL에 넣으면 다음 배포부터 붙는다.
# 여섯 경로는 이 주소 하나에서 유도된다 — 환경변수를 여섯으로 늘리지 않는다.
#
# 띄우기 전에 번들이 되는지만 먼저 본다. 로그인도 계정도 필요 없다:
pnpm dlx wrangler@3 deploy --dry-run --outdir /tmp/w   # 42KB / gzip 10.6KB (2026-08-30)

pnpm --filter @minui/harvester recall  # 자동 수집 회수율 (손 수집본 대비)

# 공개 배포를 실제 브라우저로 밟아 본다. 로컬 소스가 아니라 배포된 주소를 겨냥한다 —
# base path·정적 자산·API 부재·브라우저 저장소는 여기서만 드러난다. 크롬이 있어야 한다.
pnpm --filter @minui/smoke smoke   # 동선 6가지
pnpm --filter @minui/smoke a11y    # 접근성 6가지. 색 대비·터치 크기를 **켜고** 잰다
pnpm --filter @minui/smoke perf    # 성능 예산. 넘으면 종료 코드 1
SMOKE_BASE_URL=http://localhost:5174/ pnpm --filter @minui/smoke smoke
pnpm --filter @minui/enricher bench:assist   # 런타임 LLM 폴백의 이득과 손해
MINUI_LLM=compat pnpm --filter @minui/enricher bench:assist    # 같은 세트를 다른 공급자로
```

주요 수치 (2026-08-14)

| | |
|---|---|
| 자동 수집 회수율 | 99% (로그인 불필요 4곳) |
| 검색 — 기기 안에서만 (**공개 배포가 이 값**) | 85% |
| 검색 — LLM 폴백까지 (로컬 전체 구성) | **95%** |
| 답 없는 질의 100건 | 97건 옳게 거절 |
| 어려운 말 풀이 커버리지 | 86% (2,522/2,948) |
| 근거(원문 인용)를 댄 뜻풀이 | 7개 — 문서가 붙은 메뉴 9개 중 (2026-08-28) |
| 개인 동의어 학습이 다른 질의를 망친 건수 | 0건 (64문항) |
| 이식 시간 | 10초 (반나절 → ) |

**이 수치들에는 흠이 있다.** 질의도 내가 쓰고 동의어도 내가 썼다 —
자세한 것은 `docs/기획안.md` §0에 적어 뒀다.

공개 배포 실측 (2026-08-27, 모바일 흉내: CPU 4배 감속 · 1.6Mbps · 지연 150ms)

| | |
|---|---|
| 동선 스모크 · 접근성 | 6/6 · 6/6 |
| 루트 — JS 전송 · LCP | 200KB · 1,800ms |
| 미니은행 — JS 전송 · LCP | 99KB · 1,388ms |
| 손이 닿은 뒤 답할 때까지 | 온보딩 906ms · 전체 메뉴 163ms · 말로 찾기 67ms |

M17~M19를 얹은 뒤 다시 쟀다 (2026-08-30). **배포본이 아니라 같은 빌드를 로컬 gzip
서버로 띄워 잰 값**이라 위 표와 나란히 놓되 같은 줄에 두지 않는다 — 아직 중계기를
배포하지 않아 공개 주소에는 이 코드가 없다.

| | 2026-08-27 (배포본) | 2026-08-30 (로컬 빌드) |
|---|---|---|
| 동선 스모크 · 접근성 | 6/6 · 6/6 | 6/6 · 6/6 |
| 루트 — JS 전송 · LCP | 200KB · 1,800ms | 200KB · 1,720ms |
| 미니은행 — JS 전송 · LCP | 99KB · 1,388ms | **105KB** · 1,304ms |
| 온보딩 → 홈 | 906ms | 862ms |
| 전체 메뉴 → 목록 | 163ms | 290ms |
| 말로 찾기 → 시트 | 67ms | 60ms |

미니은행이 6KB 늘었다 — 안심 점검·읽어 주기·요약이 들어간 값이고 예산 146KB 안이다.
**여덟 칸 전부 예산 안이라 지금도 번들을 쪼개지 않는다.**

접근성 재측정에서 **진짜 결함을 하나 잡았다.** 연습 모드 진입 버튼을 조용해 보이게
하려고 44px로 뒀는데, 이 저장소가 정한 기준은 88px이다. 조용해 보이는 것과 작은 것은
다른 문제라 — 무게는 색과 밑줄로 낮추고 누를 면적은 지켰다. 적응 UI 동의 버튼이
40px이었던 것을 잡았던 그 검사가 또 잡았다.

빌드가 "청크가 크다"고 경고하는 원본 1.17MB는 gzip으로 **200KB**가 도착한다.
쪼개면 왕복이 늘어 첫 화면이 오히려 늦어진다. 접근성 실측은 `docs/기획안.md` §11.3에 있다.

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
| `packages/core/src/safety.ts` | 막지 않으면서 읽게 만드는 법 |
| `services/enricher/src/confirm.ts` | 모델이 말투를 정하고 값은 못 만지게 하는 법 |
| `shared/host-ai/privacy.ts` | 원격 경계 넷이 같은 문을 지나게 하는 법 |
| `packages/voice/src/TtsProvider.ts` | 소리로 읽어 줄 때 계좌번호를 어디까지 읽는가 |
| `backend/.../TransferService.java` | 격리 수준과 락이 각자 맡는 몫 |
| `services/harvester/src/extract.ts` | 다섯 사이트가 서로 다른 방식으로 메뉴를 그린다 |
| `services/enricher/src/prompt.ts` | 모델을 믿지 않고 검증하는 자리 |
| `demos/src/studioRoute.ts` | 링크 하나가 카탈로그가 되는 전 과정 |
| `docs/기획안.md` §16 | 실패하고 되돌린 것들 — 되돌린 이유가 더 쓸모 있다 |
