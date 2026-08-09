# MinUI Engine

> 자주 쓰는 기능만 큰 카드로 남기고, 나머지 메뉴는 음성으로 불러내는 **이식형 UI 레이어**.
> 어떤 금융 앱에도 얹을 수 있게 설계하고, 이체 기능을 갖춘 데모 은행 앱 위에서 검증한다.

기획안은 [`docs/기획안.md`](docs/기획안.md), 측정 결과는 [`docs/검증결과.md`](docs/검증결과.md).

## 띄우기

세 가지를 순서대로 켠다.

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

## 구조

```
packages/core     @minui/core    프레임워크 무관 엔진. 의존성 0
packages/react    @minui/react   React 바인딩 + 접근성 디자인 토큰
packages/voice    @minui/voice   STT Provider 인터페이스와 구현체
frontend                         데모 은행 앱 (두 UI 모드)
backend                          Spring Boot 계정계 (복식부기 원장)
tools                            벤치마크·시뮬레이션·리포트
docs                             기획안과 측정 결과
```

호스트 앱이 엔진에 제공할 것은 두 개뿐이다 — 메뉴 카탈로그(JSON)와
메뉴 ID를 받아 화면을 여는 함수. 자세한 계약은 [`packages/core/README.md`](packages/core/README.md).

## 검증

```bash
pnpm test                              # 256 tests (core · voice · react · frontend)
pnpm typecheck
cd backend && ./gradlew test           # Testcontainers 통합 테스트 6종

pnpm --filter tools bench:search       # 구어체 질의 50건 검색 정확도
pnpm --filter tools simulate           # 120일 개인화 시뮬레이션
pnpm --filter tools report             # §12.1 지표 표
```

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
| `docs/검증결과.md` | 목표에 미달한 지표와 그 이유 |
