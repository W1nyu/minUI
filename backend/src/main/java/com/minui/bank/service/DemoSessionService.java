package com.minui.bank.service;

import com.minui.bank.domain.DemoUser;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.DemoUserRepository;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 시연용 세션.
 *
 * <p><b>이것은 인증이 아니고 비밀번호도 없다.</b> 토큰은 서명되지 않고, 만료되지 않고,
 * 잠기지 않는다. 아는 사람이면 그냥 들어간다 — 로그인 화면의 키패드는 은행 앱의 모양을
 * 보여 주려고 둔 시늉이라 서버가 받을 값이 없다. 그렇게 둔 것이 의도다: 비교할 번호를
 * 어딘가에 두면 그것만으로 "지켜지고 있다"고 말하게 되는데 이 서버가 지키는 것은
 * 아무것도 없다. {@code demo-session-token}을 다룬 방식 그대로다.
 *
 * <p>토큰을 메모리에만 두는 것도 같은 이유다. 재시작하면 사라지고, 그래도 되는 물건이다.
 * 프런트는 토큰이 없으면 없는 대로 돈다 — 없는 것이 고장으로 보이지 않게 하는 이 저장소의
 * 방식이다.
 */
@Service
@Transactional(readOnly = true)
public class DemoSessionService {

    private final DemoUserRepository users;
    private final AccountRepository accounts;
    private final Map<String, String> userIdByToken = new ConcurrentHashMap<>();

    public DemoSessionService(DemoUserRepository users, AccountRepository accounts) {
        this.users = users;
        this.accounts = accounts;
    }

    /**
     * 화면에 내보내도 되는 만큼만.
     *
     * <p>{@code accountCount}가 있는 이유: 로그인 화면이 사람 카드에 "통장 2개"를 적는데,
     * 그것 때문에 사람마다 계좌 목록을 한 번씩 더 부르게 하면 열둘이면 열두 번이다.
     */
    public record UserView(
            String id, String name, String ageBand, String group, long accountCount) {}

    public java.util.List<UserView> listUsers() {
        return users.findAll().stream()
                .map(
                        user ->
                                new UserView(
                                        user.getId(),
                                        user.getName(),
                                        user.getAgeBand(),
                                        user.getGroup(),
                                        accounts.findByOwnerId(user.getId()).size()))
                .toList();
    }


    /** 아는 사람이면 표식을 준다. 모르는 사람이면 빈 값이다 — 그것이 유일한 판단이다. */
    public Optional<String> signIn(String userId) {
        Optional<DemoUser> user = users.findById(userId);
        if (user.isEmpty()) return Optional.empty();

        String token = "demo-" + userId;
        userIdByToken.put(token, userId);
        return Optional.of(token);
    }

    /**
     * 이 표식이 가리키는 사람.
     *
     * <p>프런트가 로그인 왕복 없이 {@code demo-<userId>} 모양으로 만들어 보내는 경우도
     * 받아 준다. 정적 데모와 로컬 서버가 같은 화면을 쓰는데 한쪽만 로그인 왕복을 요구하면
     * 두 경로의 동작이 갈라지기 때문이다 — <b>지키는 것이 없으므로 잃는 것도 없다.</b>
     */
    public Optional<String> userIdOf(String token) {
        if (token == null || token.isBlank()) return Optional.empty();

        String remembered = userIdByToken.get(token);
        if (remembered != null) return Optional.of(remembered);

        String derived = token.startsWith("demo-") ? token.substring("demo-".length()) : null;
        return Optional.ofNullable(derived).filter(users::existsById);
    }
}
