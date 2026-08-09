package com.minui.bank.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * 이체 한 건. 분개들을 묶는 단위이며, 그 자체로 잔액에 영향을 주지 않는다.
 *
 * <p>진실은 분개에 있고 이것은 묶음일 뿐이라는 순서가 중요하다. 거꾸로 두면
 * "이체는 성공했는데 분개가 없는" 상태를 표현할 수 있게 되고, 그 순간 원장은
 * 신뢰를 잃는다.
 */
@Entity
@Table(name = "transfers")
public class Transfer {

    @Id
    @Column(length = 40)
    private String id;

    @Column(name = "from_account_id", nullable = false, length = 40)
    private String fromAccountId;

    @Column(name = "to_account_id", nullable = false, length = 40)
    private String toAccountId;

    @Column(nullable = false, precision = 19, scale = 2)
    private BigDecimal amount;

    @Column(length = 120)
    private String memo;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected Transfer() {
        // JPA용
    }

    public Transfer(
            String id,
            String fromAccountId,
            String toAccountId,
            BigDecimal amount,
            String memo,
            Instant createdAt) {
        this.id = id;
        this.fromAccountId = fromAccountId;
        this.toAccountId = toAccountId;
        this.amount = amount;
        this.memo = memo;
        this.createdAt = createdAt;
    }

    /**
     * 복식부기 불변식: 차변 합 = 대변 합.
     *
     * <p>기록하기 직전에 확인한다. 저장한 뒤에 검사하면 이미 깨진 원장을 발견하는 것이라
     * 검증이 아니라 사후 통보가 된다.
     */
    public static void assertBalanced(List<LedgerEntry> entries) {
        BigDecimal debit = BigDecimal.ZERO;
        BigDecimal credit = BigDecimal.ZERO;

        for (LedgerEntry entry : entries) {
            if (entry.getSide() == LedgerEntry.Side.DEBIT) {
                debit = debit.add(entry.getAmount());
            } else {
                credit = credit.add(entry.getAmount());
            }
        }

        if (debit.compareTo(credit) != 0) {
            throw new IllegalStateException(
                    "차변과 대변이 맞지 않습니다. 차변=%s 대변=%s".formatted(debit, credit));
        }
    }

    public String getId() {
        return id;
    }

    public String getFromAccountId() {
        return fromAccountId;
    }

    public String getToAccountId() {
        return toAccountId;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getMemo() {
        return memo;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
