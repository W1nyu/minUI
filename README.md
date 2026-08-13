# MinUI Engine

> 자주 쓰는 기능만 큰 카드로 남기고, 나머지 메뉴는 음성으로 불러내는 **이식형 UI 레이어**.
> 어떤 금융 앱에도 얹을 수 있게 설계하고, 실제 금융사 5곳과 데모 은행 앱 위에서 검증한다.

기획안은 [`docs/기획안.md`](docs/기획안.md), 측정 결과는 [`docs/검증결과.md`](docs/검증결과.md).

## 빨리 보려면 — MinUI Studio

**금융사 주소를 넣으면 10초 만에 그 회사에 얹힌 쉬운 모드가 뜬다.**

```bash
pnpm install
pnpm --filter demos dev     # → http://localhost:5174/studio
```

주소를 넣으면 전체메뉴를 읽어 카탈로그를 만들고, 첫 화면 카드를 고르고, 미리보기와
이식 코드 두 줄을 보여 준다. 하나은행 10.7초 / KB증권 5.3초에 끝난다.

같은 앱의 `/shinhan` `/kbsec` `/hana`는 미리 만들어 둔 세 곳이다.

> **이 경로에는 LLM이 없다.** 수집(Playwright)·조립·첫 화면 넉 장이 전부 결정론이라
> 같은 주소를 넣으면 같은 결과가 나오고, 키가 없어도 완전히 같은 것이 나온다.
>
> LLM은 **사용자가 무언가를 물었을 때만** 부른다 — 온디바이스 검색이 놓친 질의(`/api/assist`)와
> 어려운 말 풀이(`/api/explain`). 저장소 루트 `api.txt`에 Google AI Studio 키가 있으면
> 켜지고, **없어도 전부 돌아간다** — 되묻기로 되돌아갈 뿐이다.

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
- **기본 UI** — 대조군. 실제 은행 앱 구조(배너·계좌 카드·아이콘 격자·탭바)를 따랐다

음성 버튼은 Chrome에서 마이크 권한을 주면 실제로 동작한다. 권한이 없거나 지원되지
않는 브라우저에서는 같은 화면의 텍스트 입력으로 똑같이 찾을 수 있다.

**음성 엔진은 둘이다.** 주 엔진은 브라우저 Web Speech, 예비는 온디바이스 Whisper다.
파이어폭스처럼 Web Speech가 없는 브라우저에서 음성이 통째로 사라지지 않게 하려는 것이고,
둘 다 안 되면 텍스트 검색이 그대로 남는다. 예비 엔진을 직접 보려면 주소에
`?stt=whisper`를 붙인다 — 두 엔진을 같은 발화로 비교하려면 필요하다(기획안 §12.2-C).

Whisper 가중치(73MB)는 저장소에 없다. `pnpm --filter tools fetch:model`로 받으면
데모가 직접 서빙하고, 안 받으면 Hugging Face CDN에서 받는다.

## 구조

```
packages/core     @minui/core    프레임워크 무관 엔진. 의존성 0
packages/react    @minui/react   React 바인딩 + 접근성 디자인 토큰
packages/voice    @minui/voice   STT Provider — Web Speech · 온디바이스 Whisper · 예비 전환
frontend                         데모 은행 앱 (두 UI 모드)
backend                          Spring Boot 계정계 (복식부기 원장)
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
pnpm test                              # 440 tests
pnpm typecheck
cd backend && ./gradlew test           # Testcontainers 통합 테스트 6종

pnpm --filter tools build:catalog      # 수집 원본 + ai + 사람 → 카탈로그
pnpm --filter tools bench:sites        # 동의어를 누가 붙였을 때 잘 찾는가 (4구성)
pnpm --filter tools bench:search       # 구어체 질의 50건
pnpm --filter tools diagnose           # 놓친 질의가 왜 놓쳤는가
pnpm --filter tools tune:threshold     # 임계값 — 정답 세트와 답 없는 세트를 함께
pnpm --filter tools fetch:model        # 예비 음성 엔진 가중치 (73MB, 저장소에 없음)

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
| 이식 시간 | 10초 (반나절 → ) |

**이 수치들에는 흠이 있다.** 질의도 내가 쓰고 동의어도 내가 썼다 —
자세한 것은 `docs/검증결과.md`에 적어 뒀다.

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
| `packages/core/src/contextBoost.ts` | 우연을 주기로 오인하지 않는 법 |
| `backend/.../TransferService.java` | 격리 수준과 락이 각자 맡는 몫 |
| `services/harvester/src/extract.ts` | 다섯 사이트가 서로 다른 방식으로 메뉴를 그린다 |
| `services/enricher/src/prompt.ts` | 모델을 믿지 않고 검증하는 자리 |
| `demos/src/studioRoute.ts` | 링크 하나가 카탈로그가 되는 전 과정 |
| `docs/검증결과.md` | 목표에 미달한 지표, 실패한 실험, 그 이유 |
