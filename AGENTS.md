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
| `services/harvester` | URL → 수집 원본 (Playwright) | 배포물이 아님. 브라우저 스니펫도 여기서 빌드 |
| `services/enricher` | LLM 연결 — 빌드 타임 보강 + 런타임 폴백 | **API 키가 여기 밖으로 나가지 않는다** |
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

7. **API 키는 저장소에도 번들에도 들어가지 않는다.**
   `api.txt`는 `.gitignore`에 있다. 클라이언트 코드에 키를 넣으면 개발자 도구에서 꺼내 쓸 수 있고,
   그 순간 남의 한도로 남의 요금이 나간다. 브라우저는 `/api/assist`·`/api/studio`로 묻고 서버가 대신 부른다.
   오류 메시지에 키가 섞여 나가는 것도 막는다(`gemini.ts`가 본문에서 키를 가린다).

8. **LLM은 위험도를 낮추지 못한다.** 정규식 판정과 모델 판정 중 **더 위험한 쪽**을 택한다
   (`combineRisk`). §9.3의 안전 경계가 모델 판단에 걸리면 음성으로 이체가 실행되는 경로가 열린다.

9. **LLM이 없어도 서비스는 100% 돈다.** 도우미가 없거나 `null`을 주거나 호출이 실패하면
   원래대로 되묻는다. `packages/core`와 `packages/react`에 네트워크·API 키·모델 이름이 들어오지 않는다 —
   호스트가 주는 것은 `assist?: (query, candidates) => Promise<MenuId | null>` 함수 하나다.

10. **LLM 동의어를 색인에 넣지 않는다.** 실측에서 해로웠다 — 사람 것만 85%가 전 메뉴에 얹으니 67%.
    미리 붙이는 방식은 모든 표현을 미리 알아맞혀야 하고 빗나간 것들이 서로를 방해한다.
    LLM은 **런타임에 사용자가 한 말을 보고** 고른다. 근거는 `docs/검증결과.md`.

## 개발 방식

- **TDD.** 로직 변경은 실패하는 테스트 → 최소 구현 → 리팩터 순서로 한다. 테스트 없는 랭킹/검색 로직 변경은 받지 않는다.
- 랭킹·안정화·검색 시나리오는 `packages/core/fixtures/*.json`에 **입력→기대 출력** 형태로 둔다. 언어 포팅 시 동등성 검증에 재사용한다.
- 완료를 주장하기 전에 실제로 명령을 실행하고 그 출력을 근거로 삼는다.

## 자주 쓰는 명령

```bash
pnpm install
pnpm test           # vitest 393개 (전 패키지)
pnpm typecheck
pnpm build

# 데모 — /shinhan /kbsec /hana, 그리고 /studio
pnpm --filter demos dev

# 카탈로그 (수집 원본 + ai + 사람 → demos/src/catalogs/)
pnpm --filter tools build:catalog

# 수집
pnpm --filter @minui/harvester harvest -- <URL> [이름]
pnpm --filter @minui/harvester recall            # 손 수집본 대비 회수율
pnpm --filter @minui/harvester build:snippet     # 로그인 사이트용 브라우저 스니펫
pnpm --filter @minui/harvester probe -- <URL>    # 왜 못 읽었는지 볼 때

# LLM (api.txt 또는 GOOGLE_API_KEY 필요)
pnpm --filter @minui/enricher enrich -- <사이트> [--limit N]
pnpm --filter @minui/enricher bench:assist       # 런타임 폴백 이득/손해

# 측정
pnpm --filter tools bench:sites        # 동의어 출처별 4구성 비교
pnpm --filter tools bench:search       # 미니은행 50문항
pnpm --filter tools diagnose           # 놓친 질의가 왜 놓쳤는가
pnpm --filter tools tune:threshold     # 임계값 저울 (정답 세트 + 답 없는 세트)
pnpm --filter tools tune:search        # 파라미터 — 튜닝/검증 세트 분리
pnpm --filter tools measure:portability

# 백엔드 (M1)
docker compose -f backend/compose.yaml up -d
cd backend && ./gradlew test
```

## 스택 고정

TypeScript(엔진) / React + Vite(프런트) / Spring Boot 4.1 + JPA + PostgreSQL(백엔드).

**LLM에 대한 규칙이 2026-08-11에 바뀌었다.** 전에는 "LLM API를 쓰지 않는다"였고, 이유는
망분리·지연·비용이었다(기획안 §8.3, §11.4). 지금은 이렇게 한다.

- **엔진은 그대로 LLM을 모른다.** `packages/*`에 네트워크가 없다. 이 선은 안 넘는다
- **빌드 타임 보강**(뜻풀이·위험도·첫 화면)은 오프라인이다. 개발자 PC에서 돌려 JSON만 배포하므로
  망분리와 무관하다
- **런타임 폴백**은 온디바이스가 실패했을 때만, 정답 있는 질의의 15%에서만 호출된다.
  꺼도 서비스가 100% 돈다
- 외부 임베딩 서비스는 여전히 쓰지 않는다. n-gram은 온디바이스로 남는다

바뀐 근거와 측정치는 `docs/검증결과.md`에 있다. 규칙을 되돌리려면 그 측정을 다시 보라.
