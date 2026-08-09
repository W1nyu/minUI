package com.minui.bank;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.minui.bank.domain.Account;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.IdempotencyRecordRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import com.minui.bank.repository.TransferRepository;
import com.minui.bank.service.TransferCoordinator;
import com.minui.bank.service.TransferService;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/**
 * 계정계 정합성 통합 테스트 (기획안 §10.1 / M1의 DoD).
 *
 * <p>여기서 재는 것은 기능의 개수가 아니라 <b>금융 거래 처리의 정확성</b>이다.
 * 네 가지가 전부 통과해야 원장을 신뢰할 수 있다.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class LedgerIntegrityTest {

    @Autowired TransferCoordinator coordinator;
    @Autowired AccountRepository accounts;
    @Autowired LedgerEntryRepository ledger;
    @Autowired TransferRepository transfers;
    @Autowired IdempotencyRecordRepository idempotency;

    private static final BigDecimal OPENING = new BigDecimal("1000000");

    @BeforeEach
    void reset() {
        ledger.deleteAll();
        transfers.deleteAll();
        idempotency.deleteAll();
        accounts.deleteAll();

        accounts.saveAll(
                List.of(
                        new Account("acc-a", "111-111-111111", "가 통장", "KRW"),
                        new Account("acc-b", "222-222-222222", "나 통장", "KRW"),
                        new Account(
                                "acc-open",
                                "000-000-000000",
                                "개시 분개",
                                "KRW",
                                Account.Type.EQUITY)));

        // 여는 잔액도 이체로 넣는다 — 원장 밖에서 생긴 돈이 없어야 하기 때문이다.
        coordinator.transfer(
                key(), new TransferService.Command("acc-open", "acc-a", OPENING, "개시"));
        coordinator.transfer(
                key(), new TransferService.Command("acc-open", "acc-b", OPENING, "개시"));
    }

    @Test
    @DisplayName("이체 후에도 전 계좌의 차변 합과 대변 합이 같다")
    void ledgerStaysBalanced() {
        coordinator.transfer(
                key(),
                new TransferService.Command("acc-a", "acc-b", new BigDecimal("150000"), "관리비"));
        coordinator.transfer(
                key(),
                new TransferService.Command("acc-b", "acc-a", new BigDecimal("30000"), "용돈"));

        assertLedgerBalanced();
        assertThat(ledger.balanceOf("acc-a"))
                .isEqualByComparingTo(OPENING.subtract(new BigDecimal("120000")));
        assertThat(ledger.balanceOf("acc-b"))
                .isEqualByComparingTo(OPENING.add(new BigDecimal("120000")));
    }

    @Test
    @DisplayName("같은 멱등성 키로 동시에 10번 보내도 이체는 한 건이다")
    void idempotencyKeyBlocksDuplicates() throws Exception {
        String sharedKey = key();
        TransferService.Command command =
                new TransferService.Command("acc-a", "acc-b", new BigDecimal("100000"), "중복");

        List<Future<TransferService.Result>> results =
                runConcurrently(10, () -> coordinator.transfer(sharedKey, command));

        // 열 요청이 모두 성공 응답을 받아야 한다. 클라이언트는 재시도가
        // 실패로 보이면 또 재시도한다.
        for (Future<TransferService.Result> future : results) {
            assertThat(future.get(30, TimeUnit.SECONDS)).isNotNull();
        }

        assertThat(transfers.count()).isEqualTo(3); // 개시 2건 + 이체 1건
        assertThat(ledger.balanceOf("acc-a"))
                .isEqualByComparingTo(OPENING.subtract(new BigDecimal("100000")));
        assertLedgerBalanced();
    }

    @Test
    @DisplayName("같은 계좌 쌍의 양방향 동시 이체 20건에서 데드락도 음수 잔액도 없다")
    void concurrentOppositeTransfersDoNotDeadlock() throws Exception {
        BigDecimal amount = new BigDecimal("10000");

        List<Callable<TransferService.Result>> tasks = new java.util.ArrayList<>();
        for (int i = 0; i < 10; i++) {
            tasks.add(
                    () ->
                            coordinator.transfer(
                                    key(),
                                    new TransferService.Command("acc-a", "acc-b", amount, "→")));
            tasks.add(
                    () ->
                            coordinator.transfer(
                                    key(),
                                    new TransferService.Command("acc-b", "acc-a", amount, "←")));
        }

        for (Future<TransferService.Result> future : runAll(tasks)) {
            // 데드락이 나면 여기서 예외가 터진다. 계좌를 ID 오름차순으로 잠그는 것이
            // 그 순환을 막는다.
            assertThat(future.get(60, TimeUnit.SECONDS)).isNotNull();
        }

        // 20건이 서로 상쇄되어 잔액은 처음과 같다.
        assertThat(ledger.balanceOf("acc-a")).isEqualByComparingTo(OPENING);
        assertThat(ledger.balanceOf("acc-b")).isEqualByComparingTo(OPENING);
        assertThat(ledger.balanceOf("acc-a")).isGreaterThanOrEqualTo(BigDecimal.ZERO);
        assertLedgerBalanced();
    }

    @Test
    @DisplayName("잔액이 모자라면 분개를 하나도 남기지 않고 되돌린다")
    void insufficientFundsRollsBackEverything() {
        long ledgerBefore = ledger.count();
        long transfersBefore = transfers.count();

        assertThatThrownBy(
                        () ->
                                coordinator.transfer(
                                        key(),
                                        new TransferService.Command(
                                                "acc-a", "acc-b", OPENING.add(BigDecimal.ONE), "초과")))
                .isInstanceOf(TransferService.TransferFailed.class)
                .hasMessageContaining("잔액이 부족합니다");

        assertThat(ledger.count()).isEqualTo(ledgerBefore);
        assertThat(transfers.count()).isEqualTo(transfersBefore);
        // 실패한 요청의 멱등성 키도 남지 않아야 한다. 남으면 같은 키로 다시 시도할 때
        // "이미 처리됨"으로 잘못 응답하게 된다.
        assertThat(idempotency.count()).isEqualTo(transfersBefore);
        assertThat(ledger.balanceOf("acc-a")).isEqualByComparingTo(OPENING);
    }

    @Test
    @DisplayName("동시 출금이 잔액을 넘지 못한다 — 락과 격리 수준이 함께 작동한다")
    void concurrentWithdrawalsCannotOverdraw() throws Exception {
        // 잔액 100만원에서 30만원씩 10건이 동시에 나간다. 최대 3건만 성공해야 한다.
        BigDecimal amount = new BigDecimal("300000");

        List<Callable<TransferService.Result>> tasks = new java.util.ArrayList<>();
        for (int i = 0; i < 10; i++) {
            tasks.add(
                    () ->
                            coordinator.transfer(
                                    key(),
                                    new TransferService.Command("acc-a", "acc-b", amount, "동시출금")));
        }

        int succeeded = 0;
        for (Future<TransferService.Result> future : runAll(tasks)) {
            try {
                future.get(60, TimeUnit.SECONDS);
                succeeded++;
            } catch (Exception expected) {
                // 잔액 부족으로 거절된 것은 정상이다.
            }
        }

        assertThat(succeeded).isEqualTo(3);
        assertThat(ledger.balanceOf("acc-a")).isEqualByComparingTo(new BigDecimal("100000"));
        assertThat(ledger.balanceOf("acc-a")).isGreaterThanOrEqualTo(BigDecimal.ZERO);
        assertLedgerBalanced();
    }

    @Test
    @DisplayName("같은 키로 다른 내용을 보내면 거절한다 — 재시도가 아니라 버그다")
    void sameKeyDifferentPayloadIsRejected() {
        String sharedKey = key();
        coordinator.transfer(
                sharedKey,
                new TransferService.Command("acc-a", "acc-b", new BigDecimal("10000"), null));

        assertThatThrownBy(
                        () ->
                                coordinator.transfer(
                                        sharedKey,
                                        new TransferService.Command(
                                                "acc-a", "acc-b", new BigDecimal("99999"), null)))
                .isInstanceOf(TransferService.IdempotencyConflict.class);
    }

    // ── 도우미 ──────────────────────────────────────────────────────────

    /** 전 계좌 차변 합 = 대변 합. 이것이 깨지면 어딘가에서 돈이 생기거나 사라졌다. */
    private void assertLedgerBalanced() {
        Object[] totals = ledger.debitAndCreditTotals().get(0);
        BigDecimal debit = (BigDecimal) totals[0];
        BigDecimal credit = (BigDecimal) totals[1];
        assertThat(debit).as("차변 합").isEqualByComparingTo(credit);
    }

    private static String key() {
        return UUID.randomUUID().toString();
    }

    private List<Future<TransferService.Result>> runConcurrently(
            int count, Callable<TransferService.Result> task) throws Exception {
        List<Callable<TransferService.Result>> tasks = new java.util.ArrayList<>();
        for (int i = 0; i < count; i++) {
            tasks.add(task);
        }
        return runAll(tasks);
    }

    private List<Future<TransferService.Result>> runAll(
            List<Callable<TransferService.Result>> tasks) throws Exception {
        // 가상 스레드로 진짜 동시에 던진다. 순차 실행이면 경쟁 자체가 일어나지 않아
        // 이 테스트들이 아무것도 검증하지 못한다.
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            return pool.invokeAll(tasks);
        }
    }
}
