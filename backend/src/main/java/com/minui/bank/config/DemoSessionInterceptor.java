package com.minui.bank.config;

import com.minui.bank.repository.AccountRepository;
import com.minui.bank.service.DemoSessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 남의 통장을 들여다보지 못하게 한다 — <b>표식을 냈을 때만.</b>
 *
 * <p>이 조건부가 핵심이다. {@code X-Demo-Session} 헤더가 <b>없으면 지금까지와 똑같이</b>
 * 동작한다. 그래야 기존 통합 테스트와 {@code curl} 대본이 그대로 돌고, 이 변경이
 * 자기 범위 밖을 건드리지 않는다. 헤더를 낸 요청은 그 사람의 계좌만 볼 수 있다.
 *
 * <p><b>이것을 인증이라고 부르지 않는다.</b> 표식은 서명되지 않았고 아무나 만들 수 있다.
 * 여기서 얻는 것은 보안이 아니라 <b>시연의 일관성</b>이다 — 박정호로 로그인해 놓고
 * 김순자의 거래내역이 뜨면 그 데모는 아무것도 보여 주지 못한 것이다.
 */
@Component
public class DemoSessionInterceptor implements HandlerInterceptor {

    private static final Pattern ACCOUNT_PATH = Pattern.compile("^/api/accounts/([^/]+)");

    private final DemoSessionService sessions;
    private final AccountRepository accounts;

    public DemoSessionInterceptor(DemoSessionService sessions, AccountRepository accounts) {
        this.sessions = sessions;
        this.accounts = accounts;
    }

    @Override
    public boolean preHandle(
            HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        String token = request.getHeader("X-Demo-Session");
        if (token == null || token.isBlank()) return true;

        Matcher path = ACCOUNT_PATH.matcher(request.getRequestURI());
        if (!path.find()) return true;

        String accountId = path.group(1);
        String userId = sessions.userIdOf(token).orElse(null);
        boolean mine =
                userId != null
                        && accounts.findById(accountId)
                                .map(account -> account.isOwnedBy(userId))
                                .orElse(false);
        if (mine) return true;

        // 오류 본문은 이 서버의 다른 곳과 같은 모양이다 (`ApiExceptionHandler`).
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"message\":\"내 계좌가 아닙니다.\"}");
        return false;
    }
}
