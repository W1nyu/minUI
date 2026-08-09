package com.minui.bank.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;

/**
 * 자동이체 등록. 시나리오 S3("자동이체 안 나가게 해야 하는데")의 목적지다.
 *
 * <p>등록 자체는 원장에 영향을 주지 않는다. 실제로 돈이 움직이는 것은 지정일에
 * 이체가 실행될 때이고, 그 실행은 다른 이체와 똑같이 분개 두 줄로 기록된다.
 * 예약과 실행을 분리해야 "등록은 되어 있으나 아직 나가지 않은" 상태를 표현할 수 있다.
 */
@Entity
@Table(name = "auto_transfers")
public class AutoTransfer {

    @Id
    @Column(length = 40)
    private String id;

    @Column(name = "from_account_id", nullable = false, length = 40)
    private String fromAccountId;

    @Column(name = "to_account_id", nullable = false, length = 40)
    private String toAccountId;

    @Column(nullable = false, length = 120)
    private String payee;

    @Column(nullable = false, precision = 19, scale = 2)
    private BigDecimal amount;

    /** 매월 며칠. */
    @Column(name = "day_of_month", nullable = false)
    private int dayOfMonth;

    @Column(nullable = false)
    private boolean active;

    protected AutoTransfer() {
        // JPA용
    }

    public AutoTransfer(
            String id,
            String fromAccountId,
            String toAccountId,
            String payee,
            BigDecimal amount,
            int dayOfMonth,
            boolean active) {
        this.id = id;
        this.fromAccountId = fromAccountId;
        this.toAccountId = toAccountId;
        this.payee = payee;
        this.amount = amount;
        this.dayOfMonth = dayOfMonth;
        this.active = active;
    }

    public void setActive(boolean active) {
        this.active = active;
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

    public String getPayee() {
        return payee;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public int getDayOfMonth() {
        return dayOfMonth;
    }

    public boolean isActive() {
        return active;
    }
}
