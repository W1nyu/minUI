package com.minui.bank.service;

import com.minui.bank.domain.Account;
import com.minui.bank.domain.IdempotencyRecord;
import com.minui.bank.domain.LedgerEntry;
import com.minui.bank.domain.Transfer;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.IdempotencyRecordRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import com.minui.bank.repository.TransferRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이체 처리 (기획안 §10.1).
 *
 * <p>이 클래스가 지키는 것은 네 가지다.
 *
 * <ol>
 *   <li><b>복식부기</b> — 이체 1건 = 출금 분개 + 입금 분개, 차·대변 합 일치
 *   <li><b>멱등성</b> — 같은 {@code Idempotency-Key}로 몇 번을 보내도 이체는 한 번
 *   <li><b>동시성</b> — 계좌를 ID 오름차순으로 잠가 데드락을 원천 차단
 *   <li><b>원자성</b> — 잔액이 모자라면 아무것도 남기지 않고 전부 되돌린다
 * </ol>
 */
@Service
public class TransferService {

    private final AccountRepository accounts;
    private final LedgerEntryRepository ledger;
    private final TransferRepository transfers;
    private final IdempotencyRecordRepository idempotency;
    private final Clock clock;

    public TransferService(
            AccountRepository accounts,
            LedgerEntryRepository ledger,
            TransferRepository transfers,
            IdempotencyRecordRepository idempotency,
            Clock clock) {
        this.accounts = accounts;
        this.ledger = ledger;
        this.transfers = transfers;
        this.idempotency = idempotency;
        this.clock = clock;
    }

    public record Command(
            String fromAccountId, String toAccountId, BigDecimal amount, String memo) {}

    public record Result(
            String transferId,
            Instant at,
            BigDecimal amount,
            String counterparty,
            BigDecimal balanceAfter,
            /** 새로 처리한 것이 아니라 이전 결과를 그대로 돌려준 경우. */
            boolean replayed) {}

    /**
     * 이체를 실행한다.
     *
     * <p><b>격리 수준은 READ COMMITTED여야 한다.</b> 직관적으로는 더 강한 REPEATABLE READ가
     * 안전해 보이지만 여기서는 정확히 반대다. PostgreSQL의 REPEATABLE READ는 트랜잭션의
     * 첫 문장에서 스냅샷을 고정한다. 두 이체가 같은 계좌에서 동시에 나갈 때, 뒤에 온
     * 트랜잭션은 락을 기다리는 동안 이미 스냅샷을 떠 놓았으므로, 락을 얻은 뒤 잔액을 세어도
     * 앞 트랜잭션이 방금 커밋한 출금 분개가 보이지 않는다. 둘 다 잔액이 충분하다고 판단해
     * 초과 인출이 난다.
     *
     * <p>READ COMMITTED에서는 문장마다 스냅샷을 새로 뜬다. 락을 얻은 시점에 잔액을 세면
     * 그때까지 커밋된 모든 분개가 보인다. 직렬화는 격리 수준이 아니라 비관적 락이 맡는다 —
     * 각자 자기 몫을 하는 구성이다.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Result transfer(String idempotencyKey, Command command) {
        validate(command);
        String fingerprint = fingerprintOf(command);

        // 두 계좌를 ID 오름차순으로 잠근다. 순서가 데드락을 막는다.
        Map<String, Account> locked = lockAccounts(command);
        Account from = locked.get(command.fromAccountId());
        Account to = locked.get(command.toAccountId());

        /*
         * 멱등성 검사를 **락을 얻은 뒤에** 한다. 순서가 핵심이다.
         *
         * 락보다 먼저 검사하면, 같은 키의 두 요청이 나란히 "처음 보는 키"라고 판단한 뒤
         * 락 앞에 줄을 선다. 앞선 요청이 커밋해도 뒤 요청은 이미 검사를 마친 뒤라
         * 그 사실을 모르고 두 번째 이체를 만든다. 실제로 그렇게 동시 요청 10건이
         * 전부 이체를 만들어 냈다.
         *
         * 락을 먼저 잡으면 뒤 요청은 앞 요청이 커밋한 뒤에야 이 줄에 도달한다.
         * READ COMMITTED에서 이 조회는 새 스냅샷을 뜨므로 앞 요청의 기록이 보인다.
         */
        Optional<Result> replay = replayIfSeen(idempotencyKey, fingerprint);
        if (replay.isPresent()) {
            return replay.get();
        }

        if (from == null) {
            throw new TransferFailed("보내는 계좌를 찾을 수 없습니다.");
        }
        if (to == null) {
            throw new TransferFailed("받는 계좌를 찾을 수 없습니다.");
        }
        if (!from.getCurrency().equals(to.getCurrency())) {
            throw new TransferFailed("통화가 다른 계좌로는 보낼 수 없습니다.");
        }

        BigDecimal available = ledger.balanceOf(from.getId());
        if (from.requiresSufficientFunds() && available.compareTo(command.amount()) < 0) {
            // 예외가 트랜잭션 전체를 되돌린다. 분개도 이체도 남지 않는다.
            // 자본 계정에는 이 검사를 하지 않는다 — 발행한 만큼 음수가 되는 것이 정상이다.
            throw new TransferFailed("잔액이 부족합니다.");
        }

        Instant now = clock.instant();
        String transferId = UUID.randomUUID().toString();

        /*
         * 키를 먼저 선점한다. 락 순서가 이미 대부분을 막지만, 서로 다른 계좌 쌍으로
         * 같은 키가 오는 경로까지 덮으려면 DB 제약이 최종 판정을 내려야 한다.
         * flush를 명시해 여기서 즉시 실패하게 한다 — 커밋 시점까지 미루면
         * 헛일을 다 하고 나서 되돌리게 된다.
         */
        idempotency.saveAndFlush(
                new IdempotencyRecord(idempotencyKey, fingerprint, transferId, now));

        List<LedgerEntry> entries = List.of(
                new LedgerEntry(
                        UUID.randomUUID().toString(),
                        from.getId(),
                        transferId,
                        LedgerEntry.Side.CREDIT,
                        command.amount(),
                        to.getNickname(),
                        now),
                new LedgerEntry(
                        UUID.randomUUID().toString(),
                        to.getId(),
                        transferId,
                        LedgerEntry.Side.DEBIT,
                        command.amount(),
                        from.getNickname(),
                        now));

        // 쓰기 직전에 확인한다. 저장한 뒤에 검사하면 검증이 아니라 사후 통보다.
        Transfer.assertBalanced(entries);

        transfers.save(
                new Transfer(
                        transferId,
                        from.getId(),
                        to.getId(),
                        command.amount(),
                        command.memo(),
                        now));
        ledger.saveAll(entries);

        return new Result(
                transferId,
                now,
                command.amount(),
                to.getNickname(),
                available.subtract(command.amount()),
                false);
    }

    /**
     * 이미 처리한 키인가.
     *
     * <p>여기서 걸러지지 않아도 최종 방어선은 {@code idempotency_records}의 기본 키다.
     * 두 요청이 동시에 이 검사를 통과하더라도 저장 시점에 하나만 살아남는다 —
     * 그 경쟁의 뒤처리는 {@link TransferCoordinator}가 한다.
     */
    private Optional<Result> replayIfSeen(String key, String fingerprint) {
        return idempotency
                .findById(key)
                .map(
                        record -> {
                            if (!record.getRequestFingerprint().equals(fingerprint)) {
                                throw new IdempotencyConflict(
                                        "같은 키로 다른 내용의 이체 요청이 왔습니다.");
                            }
                            return replayResult(record);
                        });
    }

    private Result replayResult(IdempotencyRecord record) {
        Transfer transfer =
                transfers
                        .findById(record.getTransferId())
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "멱등성 기록이 가리키는 이체가 없습니다: "
                                                        + record.getTransferId()));

        String counterparty =
                accounts.findById(transfer.getToAccountId())
                        .map(Account::getNickname)
                        .orElse("");

        return new Result(
                transfer.getId(),
                transfer.getCreatedAt(),
                transfer.getAmount(),
                counterparty,
                ledger.balanceOf(transfer.getFromAccountId()),
                true);
    }

    private Map<String, Account> lockAccounts(Command command) {
        List<String> ids =
                command.fromAccountId().compareTo(command.toAccountId()) <= 0
                        ? List.of(command.fromAccountId(), command.toAccountId())
                        : List.of(command.toAccountId(), command.fromAccountId());

        return accounts.lockAllByIdInOrder(ids).stream()
                .collect(Collectors.toMap(Account::getId, Function.identity()));
    }

    private void validate(Command command) {
        if (command.amount() == null || command.amount().signum() <= 0) {
            throw new TransferFailed("보낼 금액을 입력해 주세요.");
        }
        if (command.fromAccountId().equals(command.toAccountId())) {
            throw new TransferFailed("같은 계좌로는 보낼 수 없습니다.");
        }
    }

    /** 같은 키의 재시도인지 판단할 요청 지문. */
    private String fingerprintOf(Command command) {
        return "%s|%s|%s"
                .formatted(
                        command.fromAccountId(),
                        command.toAccountId(),
                        command.amount().stripTrailingZeros().toPlainString());
    }

    /**
     * 이미 처리된 키의 결과를 다시 읽는다. 동시 요청 경쟁에서 진 쪽이 쓴다.
     *
     * @see TransferCoordinator
     */
    @Transactional(readOnly = true)
    public Optional<Result> findResultByKey(String idempotencyKey) {
        return idempotency.findById(idempotencyKey).map(this::replayResult);
    }

    public static class TransferFailed extends RuntimeException {
        public TransferFailed(String message) {
            super(message);
        }
    }

    public static class IdempotencyConflict extends RuntimeException {
        public IdempotencyConflict(String message) {
            super(message);
        }
    }
}
