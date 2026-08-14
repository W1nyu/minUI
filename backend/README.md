# backend — 데모 은행 계정계

Spring Boot 4.1 · Java 26 · JPA · PostgreSQL 18

기획안 §10.1의 요구를 실제로 구현한 최소 계정계다. 목표는 기능 개수가 아니라
**금융 거래 처리의 정확성**이다.

## 띄우기

```bash
docker compose -f compose.yaml up -d   # PostgreSQL (5433)
./gradlew bootRun                      # 8080
./gradlew test                         # Testcontainers 통합 테스트
```

프런트(`../frontend`)는 `http://localhost:8080`을 기본값으로 본다.

## 설계에서 양보하지 않은 것

**계좌에 잔액 컬럼이 없다.** 잔액은 언제나 분개의 합으로 산출한다. 잔액을 컬럼으로 들고
UPDATE 하면 원장과 어긋날 수 있고, 어긋난 뒤에는 무엇이 옳은지 판단할 근거가 없다.
대가는 조회 성능이고, 실제 계정계는 잔액 스냅샷으로 보완한다 — 다만 그것도
"스냅샷은 파생물, 원장이 진실"이라는 순서를 지킨 위에서 하는 최적화다.

**개시 잔액도 분개로 넣는다.** 자본 계정(`Account.Type.EQUITY`)에서 나오며, 그 계정은
발행 총액만큼 음수가 된다. 덕분에 "전 계좌 잔액의 합 = 0"이라는 감사 질의 하나로
원장 밖에서 생긴 돈이 없음을 확인할 수 있다.

**금액은 `BigDecimal`이다.** `double`은 0.1을 정확히 표현하지 못하고 그 오차가 합계에
쌓인다.

## 동시성

계좌를 **ID 오름차순으로** 잠근다. A→B와 B→A가 동시에 들어올 때 각자 자기 출금 계좌부터
잠그면 데드락이 나지만, 모두 같은 순서로 잠그면 그 순환이 생기지 않는다.

격리 수준은 **READ COMMITTED**다. REPEATABLE READ가 더 안전해 보이지만 여기서는 반대다 —
이유는 `TransferService#transfer`의 주석과 `docs/기획안.md` §12.3에 적어 두었다.

## 멱등성

`Idempotency-Key` 헤더는 필수다. 방어선이 세 겹이다.

1. 계좌 락을 잡은 **뒤에** 키를 조회한다 — 앞선 동시 요청의 커밋이 보인다
2. 키를 `saveAndFlush`로 선점한다 — 헛일하기 전에 실패한다
3. 최종 판정은 `idempotency_records`의 기본 키 제약이 내린다

같은 키로 **다른 내용**이 오면 409다. 재시도가 아니라 클라이언트 버그이고,
조용히 옛 결과를 돌려주면 그 버그가 영영 드러나지 않는다.

## API

| | |
|---|---|
| `GET /api/accounts` | 계좌 목록 (잔액은 원장 합계) |
| `GET /api/accounts/{id}` | 계좌 하나 |
| `GET /api/accounts/{id}/transactions?from&to` | 거래 내역 |
| `GET /api/accounts/{id}/auto-transfers` | 자동이체 목록 |
| `POST /api/auto-transfers/{id}` | 자동이체 켜기/끄기 |
| `GET /api/accounts/{id}/payees` | 최근 보낸 곳 (이체 기록에서 도출) |
| `GET /api/accounts/{id}/upcoming-deposits` | 입금 예정 (원장에서 주기 추정) |
| `POST /api/transfers` | 이체 — `Idempotency-Key` 필수 |
