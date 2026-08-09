package com.minui.bank;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 통합 테스트용 PostgreSQL.
 *
 * <p>H2가 아니라 진짜 PostgreSQL을 띄우는 이유는 이 프로젝트에서 검증해야 하는 것이
 * 바로 DB의 동시성 동작이기 때문이다 — 비관적 락의 대기, 격리 수준의 스냅샷 시점,
 * 기본 키 제약의 경쟁 판정. 인메모리 DB로는 이 중 어느 것도 정직하게 재현되지 않는다.
 *
 * <p>이미지 태그를 {@code latest}가 아니라 고정 버전으로 둔다. 테스트가 언제 돌든
 * 같은 것을 재야 한다.
 */
@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {

    @Bean
    @ServiceConnection
    PostgreSQLContainer postgresContainer() {
        return new PostgreSQLContainer(DockerImageName.parse("postgres:18-alpine"));
    }
}
