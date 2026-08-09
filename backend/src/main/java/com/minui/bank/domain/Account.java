package com.minui.bank.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

/**
 * 계좌.
 *
 * <p><b>잔액 컬럼이 없다.</b> 기획안 §10.1이 정한 가장 중요한 설계다. 잔액을 컬럼으로 들고
 * UPDATE 하면 원장과 잔액이 어긋날 수 있고, 어긋난 뒤에는 무엇이 옳은지 판단할 근거가 없다.
 * 잔액은 언제나 분개의 합으로 산출한다 — 그래야 정합성을 감사할 수 있다.
 *
 * <p>대가는 조회 성능이다. 거래가 쌓이면 합계 질의가 무거워진다. 실제 계정계는 잔액 스냅샷
 * 테이블로 보완하는데, 그것도 "스냅샷은 파생물이고 원장이 진실"이라는 순서를 지킨 위에서
 * 하는 최적화다. 데모에서는 그 순서만 정확히 보여 주고 최적화는 하지 않는다.
 */
@Entity
@Table(name = "accounts")
public class Account {

    /**
     * 계정 종류. 잔액이 음수일 수 있는지가 여기서 갈린다.
     *
     * <p>복식부기에서 돈은 무에서 생기지 않는다. 통장에 개시 잔액 100만원을 넣으려면
     * 어딘가에서 100만원이 나와야 하고, 그 출처가 자본 계정이다. 자본 계정의 잔액은
     * 지금까지 발행한 금액만큼 음수가 되며 그것이 정상이다 — 그 음수의 절댓값이
     * "이 시스템 안에 있는 돈의 총량"이다.
     *
     * <p>이 구분이 없으면 개시 잔액을 넣을 방법이 두 가지뿐이다. 잔액 검사를 통째로
     * 빼거나(그러면 초과 인출을 막을 수 없다), 원장을 우회해 잔액을 심는 것(그러면
     * 원장이 진실이라는 전제가 깨진다). 둘 다 §10.1이 세운 것을 무너뜨린다.
     */
    public enum Type {
        /** 고객 계좌. 잔액이 음수가 될 수 없다. */
        ASSET,
        /** 자본 계정. 발행한 만큼 음수가 되는 것이 정상이다. */
        EQUITY
    }

    @Id
    @Column(length = 40)
    private String id;

    @Column(nullable = false, unique = true, length = 30)
    private String number;

    @Column(nullable = false, length = 60)
    private String nickname;

    @Column(nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Type type;

    /**
     * 낙관적 락 버전. 비관적 락과 함께 두는 이유는 방어선이 다르기 때문이다 —
     * 비관적 락은 이체 트랜잭션 안에서 순서를 강제하고, 이 버전은 그 밖의 경로로
     * 들어온 수정이 조용히 덮어쓰는 것을 막는다.
     */
    @Version
    private long version;

    protected Account() {
        // JPA용
    }

    /** 고객 계좌를 만든다. */
    public Account(String id, String number, String nickname, String currency) {
        this(id, number, nickname, currency, Type.ASSET);
    }

    public Account(String id, String number, String nickname, String currency, Type type) {
        this.id = id;
        this.number = number;
        this.nickname = nickname;
        this.currency = currency;
        this.type = type;
    }

    /** 이 계좌에서 나가는 돈에 잔액 검사를 적용해야 하는가. */
    public boolean requiresSufficientFunds() {
        return type == Type.ASSET;
    }

    public Type getType() {
        return type;
    }

    public String getId() {
        return id;
    }

    public String getNumber() {
        return number;
    }

    public String getNickname() {
        return nickname;
    }

    public String getCurrency() {
        return currency;
    }

    public long getVersion() {
        return version;
    }
}
