package com.minui.bank.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * 원장 분개 한 줄. 복식부기의 최소 단위다.
 *
 * <p>이체 한 건은 반드시 두 줄 이상으로 기록되고, 차변 합과 대변 합이 같아야 한다.
 * 이 불변식이 깨지면 어딘가에서 돈이 생기거나 사라졌다는 뜻이다.
 *
 * <p>금액에 {@code BigDecimal}을 쓴다. {@code double}은 0.1을 정확히 표현하지 못하고,
 * 그 오차가 합계에 쌓인다. 돈을 부동소수로 다루면 안 되는 이유는 이 하나로 충분하다.
 */
@Entity
@Table(
        name = "ledger_entries",
        indexes = {
                @Index(name = "idx_ledger_account", columnList = "account_id"),
                @Index(name = "idx_ledger_transfer", columnList = "transfer_id")
        })
public class LedgerEntry {

    public enum Side {
        /** 차변 — 자산의 증가. 받는 계좌에 기록된다. */
        DEBIT,
        /** 대변 — 자산의 감소. 보내는 계좌에 기록된다. */
        CREDIT
    }

    @Id
    @Column(length = 40)
    private String id;

    @Column(name = "account_id", nullable = false, length = 40)
    private String accountId;

    @Column(name = "transfer_id", nullable = false, length = 40)
    private String transferId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 6)
    private Side side;

    /** 언제나 양수. 방향은 {@link Side}가 나타낸다. */
    @Column(nullable = false, precision = 19, scale = 2)
    private BigDecimal amount;

    @Column(nullable = false, length = 120)
    private String counterparty;

    @Column(name = "posted_at", nullable = false)
    private Instant postedAt;

    protected LedgerEntry() {
        // JPA용
    }

    public LedgerEntry(
            String id,
            String accountId,
            String transferId,
            Side side,
            BigDecimal amount,
            String counterparty,
            Instant postedAt) {
        if (amount.signum() <= 0) {
            throw new IllegalArgumentException("분개 금액은 양수여야 합니다: " + amount);
        }
        this.id = id;
        this.accountId = accountId;
        this.transferId = transferId;
        this.side = side;
        this.amount = amount;
        this.counterparty = counterparty;
        this.postedAt = postedAt;
    }

    /** 이 분개가 계좌 잔액에 더하는 값. 대변은 음수로 기여한다. */
    public BigDecimal signedAmount() {
        return side == Side.DEBIT ? amount : amount.negate();
    }

    public String getId() {
        return id;
    }

    public String getAccountId() {
        return accountId;
    }

    public String getTransferId() {
        return transferId;
    }

    public Side getSide() {
        return side;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCounterparty() {
        return counterparty;
    }

    public Instant getPostedAt() {
        return postedAt;
    }
}
