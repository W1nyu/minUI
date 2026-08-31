package com.minui.bank.config;

import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class BankConfiguration {

    /** 시각을 빈으로 둔다. 엔진 쪽과 같은 이유 — 테스트에서 고정할 수 있어야 한다. */
    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public WebMvcConfigurer corsConfigurer(
            @Value("${minui.cors.allowed-origins}") String[] allowedOrigins,
            DemoSessionInterceptor demoSession) {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                // 표식을 낸 요청만 걸러진다. 안 낸 요청은 지금까지와 똑같이 지나간다.
                registry.addInterceptor(demoSession).addPathPatterns("/api/accounts/**");
            }

            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                        .allowedOrigins(allowedOrigins)
                        .allowedMethods("GET", "POST")
                        .allowedHeaders(
                                "Content-Type",
                                "Idempotency-Key",
                                "Authorization",
                                "X-Demo-Session");
                /*
                 * 이체 요청도 `X-Demo-Session`을 달고 온다.
                 *
                 * <p>여기에 그 헤더를 안 적어 뒀다가 한 번 걸렸다 — 프리플라이트가 막혀
                 * <b>이체만</b> 조용히 실패했다. 조회는 다 되는데 보내기만 안 되니, 화면만
                 * 보면 이체 로직을 의심하게 된다. 프런트가 모든 요청에 같은 헤더를 다는
                 * 이상 두 매핑이 같은 목록을 가져야 한다.
                 */
                registry.addMapping("/mock/openbanking/**")
                        .allowedOrigins(allowedOrigins)
                        .allowedMethods("GET", "POST")
                        .allowedHeaders("Content-Type", "Authorization", "X-Demo-Session");
            }
        };
    }
}
