package com.minui.bank.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import org.springframework.data.domain.Persistable;

/**
 * 멱등성 키 → 처리 결과.
 *
 * <p>네트워크가 끊겨 응답을 못 받은 클라이언트는 같은 요청을 다시 보낸다. 그때 이체가
 * 두 번 일어나면 안 된다. 키를 기본 키로 두면 DB의 유니크 제약이 곧 중복 차단 장치가 된다 —
 * 애플리케이션에서 "먼저 조회하고 없으면 삽입"하는 방식은 동시 요청 사이에 틈이 생긴다.
 *
 * <p>요청 지문을 함께 저장하는 이유: 같은 키로 <b>다른 내용</b>의 요청이 오면 재시도가
 * 아니라 클라이언트 버그다. 조용히 옛 결과를 돌려주면 그 버그가 영영 드러나지 않는다.
 */
@Entity
@Table(name = "idempotency_records")
public class IdempotencyRecord implements Persistable<String> {

    @Id
    @Column(name = "idempotency_key", length = 120)
    private String key;

    @Column(name = "request_fingerprint", nullable = false, length = 200)
    private String requestFingerprint;

    @Column(name = "transfer_id", nullable = false, length = 40)
    private String transferId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected IdempotencyRecord() {
        // JPA용
    }

    public IdempotencyRecord(
            String key, String requestFingerprint, String transferId, Instant createdAt) {
        this.key = key;
        this.requestFingerprint = requestFingerprint;
        this.transferId = transferId;
        this.createdAt = createdAt;
    }

    /**
     * 이 엔티티는 언제나 새것으로 간주된다.
     *
     * <p>ID를 직접 할당하는 엔티티에 Spring Data의 {@code save()}를 쓰면 {@code merge()}가
     * 호출된다. merge는 "있으면 UPDATE, 없으면 INSERT"라서 중복 키를 조용히 덮어쓴다 —
     * 중복 차단 장치가 있는데 발동하지 않는 상태가 된다. 실제로 동시 요청 10건이 전부
     * 이체를 만들어 냈고, 원인이 이것이었다.
     *
     * <p>{@link Persistable#isNew()}로 항상 새것이라고 알려 주면 {@code persist()}가
     * 호출되어 진짜 INSERT가 나가고, 기본 키 제약이 최종 판정을 내린다.
     */
    @Transient private boolean isNew = true;

    @Override
    public String getId() {
        return key;
    }

    @Override
    public boolean isNew() {
        return isNew;
    }

    @PostLoad
    @PostPersist
    void markNotNew() {
        this.isNew = false;
    }

    public String getKey() {
        return key;
    }

    public String getRequestFingerprint() {
        return requestFingerprint;
    }

    public String getTransferId() {
        return transferId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
