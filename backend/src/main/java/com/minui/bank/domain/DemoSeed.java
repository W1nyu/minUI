package com.minui.bank.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * 지금 깔려 있는 시연 데이터가 몇 판인가.
 *
 * <p>이 한 줄이 필요한 이유는 {@code DemoDataLoader}가 원래 {@code accounts.count() > 0}
 * 이면 아무것도 안 하고 돌아 나갔기 때문이다. 개발용 Docker 볼륨을 지우지 않고 쓰는 것이
 * 정상 흐름이라 그 판단은 옳았지만, 그 결과 <b>새로 늘린 사람이 기존 DB에는 영영 안
 * 들어온다.</b> 예전에는 {@code acc-6} 하나를 특별히 덧붙이는 가지로 때웠다 — 사람이
 * 열둘로 늘면 그 방식은 안 된다.
 *
 * <p>그래서 판 번호를 남긴다. 표({@code demo-users.json})의 {@code version}이 올라가면
 * 데모 테이블을 비우고 다시 깐다. <b>지운다는 사실을 로그와 README에 적는다</b> —
 * 조용히 지우는 것이 이 저장소에서 제일 하면 안 되는 일이다.
 */
@Entity
@Table(name = "demo_seed")
public class DemoSeed {

    /** 줄이 하나뿐인 표다. 키는 고정 문자열로 둔다. */
    public static final String SINGLETON = "demo";

    @Id
    @Column(length = 20)
    private String id;

    @Column(nullable = false)
    private int version;

    protected DemoSeed() {
        // JPA용
    }

    public DemoSeed(int version) {
        this.id = SINGLETON;
        this.version = version;
    }

    public int getVersion() {
        return version;
    }

    /**
     * 판 번호를 올린다.
     *
     * <p>지우고 새로 넣지 않고 <b>있는 줄을 고친다.</b> 지우는 쪽으로 만들었다가 한 번
     * 걸렸다 — 시작할 때 {@code findById}로 읽어 둔 줄이 영속성 컨텍스트에 남아 있는데
     * 대량 삭제({@code deleteAllInBatch})는 그 컨텍스트를 건너뛴다. 그래서 커밋할 때
     * Hibernate가 이미 없는 줄에 UPDATE를 날리고 <i>expected row count 1 but was 0</i>으로
     * 죽는다. 한 줄짜리 표에 삭제가 필요할 이유도 없다.
     */
    public void moveTo(int version) {
        this.version = version;
    }
}
