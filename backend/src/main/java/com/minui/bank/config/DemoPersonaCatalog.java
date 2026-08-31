package com.minui.bank.config;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * 시연용 사람과 계좌 표를 읽는다 — {@code shared/contracts/demo-users.json}.
 *
 * <p><b>브라우저 원장과 같은 파일이다.</b> 전에는 이 서버의 시드에 여섯 계좌가 박혀
 * 있었고 {@code frontend/src/api/openBankingMock.ts}에도 같은 여섯이 따로 박혀 있었다.
 * 한쪽만 고치면 조용히 갈라지고, 갈라지면 "어디서 봤느냐"에 따라 다른 사람이 나온다.
 * {@code openbanking-cases.json}을 두 Mock이 함께 읽는 것과 같은 이유다.
 *
 * <p>{@code build.gradle}의 {@code processResources}가 이 파일을 클래스패스로 복사한다.
 *
 * <p><b>표에 비밀번호가 없다.</b> 로그인 화면의 키패드는 은행 앱의 모양을 보여 주려고
 * 둔 시늉이고 무엇을 눌러도 들어간다 — 비교할 값이 필요 없다.
 */
@Component
public class DemoPersonaCatalog {

    private static final String RESOURCE = "demo-users.json";

    private final Contract contract;
    private final Map<String, PersonaAccount> accountsById;
    private final Map<String, PersonaUser> usersById;

    public DemoPersonaCatalog() {
        this.contract = load();
        this.accountsById =
                contract.accounts().stream()
                        .collect(Collectors.toMap(PersonaAccount::id, Function.identity()));
        this.usersById =
                contract.users().stream()
                        .collect(Collectors.toMap(PersonaUser::id, Function.identity()));
    }

    private static Contract load() {
        try (InputStream stream = new ClassPathResource(RESOURCE).getInputStream()) {
            return new ObjectMapper().readValue(stream, Contract.class);
        } catch (IOException failure) {
            // 시드가 없으면 데모가 빈 은행으로 뜬다. 조용히 넘어가면 원인을 못 찾는다.
            throw new IllegalStateException(
                    "시연용 사람 표(%s)를 읽지 못했습니다.".formatted(RESOURCE), failure);
        }
    }

    /** 표의 판 번호. 이 값이 올라가면 {@link DemoDataLoader}가 데모 데이터를 다시 깐다. */
    public int version() {
        return contract.version();
    }

    public List<PersonaUser> users() {
        return contract.users();
    }

    public List<PersonaAccount> accounts() {
        return contract.accounts();
    }

    public List<HistoryEntry> history() {
        return contract.history();
    }

    public List<PersonaAutoTransfer> autoTransfers() {
        return contract.autoTransfers();
    }

    public List<PersonaDeposit> upcomingDeposits() {
        return contract.upcomingDeposits();
    }

    public Optional<PersonaAccount> account(String accountId) {
        return Optional.ofNullable(accountsById.get(accountId));
    }

    public Optional<PersonaUser> user(String userId) {
        return Optional.ofNullable(usersById.get(userId));
    }

    /**
     * 그 계좌의 예금주 이름.
     *
     * <p>전에는 {@code OpenBankingMockController}가 무조건 {@code "김순자"}를 돌려줬다.
     * 사용자가 한 사람이던 때의 흔적이고, 사람이 늘면 남의 이체 응답에 남의 이름이 붙는다.
     */
    public String holderName(String accountId) {
        return account(accountId)
                .map(
                        personaAccount ->
                                personaAccount.ownerId() == null
                                        ? personaAccount.nickname()
                                        : user(personaAccount.ownerId())
                                                .map(PersonaUser::name)
                                                .orElse(personaAccount.nickname()))
                .orElse("미니은행 이용자");
    }

    /**
     * 주인이 그 통장을 부르는 이름 ("주거래 통장").
     *
     * <p>DB의 {@code Account.nickname}에는 <b>남이 부르는 이름</b>("김순자")이 들어 있다 —
     * 원장의 상대방 표기와 받는 분 목록이 그 값을 쓰기 때문이다. 내 통장 목록에서는
     * 반대쪽이 필요하다. 한 칸으로 합치면 둘 중 하나가 반드시 틀린다.
     */
    public String ownerLabel(String accountId) {
        return account(accountId).map(PersonaAccount::ownerLabel).orElse("통장");
    }

    public String bankCode(String accountId) {
        return account(accountId).map(PersonaAccount::bankCode).orElse("088");
    }

    public String bankName(String accountId) {
        return account(accountId).map(PersonaAccount::bankName).orElse("미니은행");
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Contract(
            int version,
            List<PersonaUser> users,
            List<PersonaAccount> accounts,
            List<HistoryEntry> history,
            List<PersonaAutoTransfer> autoTransfers,
            List<PersonaDeposit> upcomingDeposits) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PersonaUser(String id, String name, String ageBand, String group) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PersonaAccount(
            String id,
            String ownerId,
            String number,
            String ownerLabel,
            String nickname,
            String bankCode,
            String bankName,
            BigDecimal opening,
            BigDecimal balance) {}

    /**
     * 시드 거래 한 줄.
     *
     * <p>{@code at}을 {@link Instant}가 아니라 문자열로 받는다 — 기본 {@code ObjectMapper}는
     * JSR-310 모듈 없이는 {@code Instant}를 못 읽는데, 모듈 하나를 더 얹는 것보다
     * {@link Instant#parse}를 여기서 부르는 편이 의존성이 적다.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record HistoryEntry(
            String from, String to, BigDecimal amount, String label, String at) {

        public Instant instant() {
            return Instant.parse(at);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PersonaAutoTransfer(
            String id,
            String fromAccountId,
            String toAccountId,
            String payee,
            BigDecimal amount,
            int dayOfMonth,
            boolean active) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PersonaDeposit(
            String id, String accountId, String label, String expectedAt, BigDecimal amount) {}
}
