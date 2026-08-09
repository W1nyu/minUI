# AGENTS.md — MinUI Engine 작업 규약

이 파일은 사람과 AI 에이전트 모두에게 적용된다. 기획안은 `docs/기획안.md`이며, 충돌 시 기획안이 우선한다.

## 프로젝트 한 줄 요약

자주 쓰는 기능만 큰 카드로 남기고 나머지는 음성·검색으로 불러내는, **어떤 금융 앱에도 얹을 수 있는 이식형 UI 레이어**. 데모 은행 앱 위에서 검증한다.

## 폴더 경계

| 경로 | 성격 | 규칙 |
|---|---|---|
| `packages/core` | 배포 대상 라이브러리 | **의존성 0.** 순수 TypeScript |
| `packages/react` | 배포 대상 라이브러리 | React 바인딩. peer로만 react 의존 |
| `packages/voice` | 배포 대상 라이브러리 | STT Provider. 브라우저 API는 구현체 안에서만 |
| `frontend` | 데모 호스트 앱 | 엔진의 **소비자**일 뿐. 여기 코드는 배포물이 아님 |
| `backend` | 데모 계정계 (Spring Boot) | 엔진과 무관. 순수 금융 도메인 |
| `tools` | 빌드/벤치/리포트 스크립트 | 런타임에 포함되지 않음 |
| `docs` | 기획안·검증 결과 | |

## 불변 규칙 (어기면 프로젝트 전제가 무너짐)

1. **`packages/core/package.json`의 `dependencies`는 비어 있어야 한다.**
   `@minui/core`는 React·DOM·`window`·`localStorage`·`IndexedDB`·Node API를 참조하지 않는다.
   저장은 반드시 주입된 `StorageAdapter`를 통한다. 시각은 반드시 주입된 `now`를 통한다 (`Date.now()` 직접 호출 금지 — 테스트 가능성).

2. **호스트 앱이 제공하는 것은 두 개뿐이다.** `MenuCatalog`(JSON)와 `ActionHandler`(함수).
   엔진에 인증·세션·라우팅·API 호출을 끌어들이지 않는다. 계약이 넓어지면 이식성이 사라진다.

3. **튜닝 값은 코드에 하드코딩하지 않는다.** 가중치·마진·임계치는 전부 `MinUIConfig`(JSON 직렬화 가능)에 둔다.
   다른 언어(예: Dart)로 포팅할 때 설정과 픽스처가 그대로 재사용되어야 한다.

4. **`riskLevel: "high"` 메뉴는 음성/검색 경로에서 자동 실행되지 않는다.**
   후보 제시 → 사용자 확인 탭 → `ActionHandler` 호출. 이 경계를 우회하는 코드는 거부한다 (기획안 §9.3).

5. **개인화는 흔들리면 안 된다.** 카드 재배치는 히스테리시스 마진·쿨다운·1회 1장 제한·지연 커밋을 전부 통과해야 한다 (기획안 §8.2).
   세션 도중에 `getCards()` 결과가 바뀌는 변경은 버그다.

6. **수집 금지 데이터**: 계좌번호, 금액, 수취인, 음성 원본. 저장하는 것은 `{메뉴ID, 시각, 완료여부}`뿐이다 (기획안 §11.1).

## 개발 방식

- **TDD.** 로직 변경은 실패하는 테스트 → 최소 구현 → 리팩터 순서로 한다. 테스트 없는 랭킹/검색 로직 변경은 받지 않는다.
- 랭킹·안정화·검색 시나리오는 `packages/core/fixtures/*.json`에 **입력→기대 출력** 형태로 둔다. 언어 포팅 시 동등성 검증에 재사용한다.
- 완료를 주장하기 전에 실제로 명령을 실행하고 그 출력을 근거로 삼는다.

## 자주 쓰는 명령

```bash
pnpm install
pnpm test           # vitest (전 패키지)
pnpm typecheck
pnpm build

# 백엔드 (M1 이후)
docker compose -f backend/compose.yaml up -d
cd backend && ./gradlew test
```

## 스택 고정

TypeScript(엔진) / React + Vite(프런트) / Spring Boot 4.1 + JPA + PostgreSQL(백엔드).
LLM API·BaaS·외부 임베딩 서비스는 쓰지 않는다 — 이유는 `docs/기획안.md` §8.3, §11.4에 있다.
