package com.minui.bank.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * 시연용 사람.
 *
 * <p><b>고객이 아니다.</b> 실명·실계좌·마이데이터와 연결되지 않는다.
 *
 * <p><b>비밀번호 칸이 없다.</b> 로그인 화면의 키패드는 은행 앱의 모양을 보여 주려고 둔
 * 시늉이고 무엇을 눌러도 들어간다. 비교할 값을 여기 두면 그것만으로 이 서버가 무언가를
 * 지킨다는 인상을 주는데, 지키는 것은 아무것도 없다.
 * {@code demo-session-token}을 다룬 방식 그대로다.
 */
@Entity
@Table(name = "demo_users")
public class DemoUser {

    @Id
    @Column(length = 40)
    private String id;

    @Column(nullable = false, length = 60)
    private String name;

    /** "70대" · "상점"처럼 화면에 그대로 뜨는 짧은 표기. */
    @Column(nullable = false, length = 20)
    private String ageBand;

    @Column(name = "user_group", nullable = false, length = 20)
    private String group;

    protected DemoUser() {
        // JPA용
    }

    public DemoUser(String id, String name, String ageBand, String group) {
        this.id = id;
        this.name = name;
        this.ageBand = ageBand;
        this.group = group;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getAgeBand() {
        return ageBand;
    }

    public String getGroup() {
        return group;
    }
}
