package com.minui.bank.config;

import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
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
            @Value("${minui.cors.allowed-origins}") String[] allowedOrigins) {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                        .allowedOrigins(allowedOrigins)
                        .allowedMethods("GET", "POST")
                        .allowedHeaders("Content-Type", "Idempotency-Key", "Authorization");
                registry.addMapping("/mock/openbanking/**")
                        .allowedOrigins(allowedOrigins)
                        .allowedMethods("GET", "POST")
                        .allowedHeaders("Content-Type", "Authorization");
            }
        };
    }
}
