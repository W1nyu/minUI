package com.minui.bank;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.minui.bank.config.DemoPersonaCatalog;
import com.minui.bank.domain.Account;
import com.minui.bank.domain.DemoUser;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.AutoTransferRepository;
import com.minui.bank.repository.DemoUserRepository;
import com.minui.bank.repository.IdempotencyRecordRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import com.minui.bank.repository.TransferRepository;
import com.minui.bank.service.AccountQueryService;
import com.minui.bank.service.TransferCoordinator;
import com.minui.bank.service.TransferService;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 사람이 여럿일 때 원장이 사람을 따라가는가.
 *
 * <p>이 데모가 여태 못 보여 준 것은 <b>받는 쪽으로 서 보는 것</b>이었다. 이체는 원장
 * 양쪽을 정확히 움직였는데 받는 쪽을 볼 화면이 없었고, 볼 화면이 없으니 서버에도
 * "누구의 계좌인가"라는 칸이 없었다. 여기서 재는 것이 그 칸이다.
 *
 * <p><b>이것은 인증 테스트가 아니다.</b> {@code X-Demo-Session}은 서명되지 않았고 아무나
 * 만들 수 있다. 재는 것은 보안이 아니라 <b>시연의 일관성</b>이다 — 박정호로 로그인해
 * 놓고 김순자의 거래내역이 뜨면 그 데모는 아무것도 보여 주지 못한 것이다.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MultiUserLedgerTest {

    @Autowired MockMvc mvc;
    @Autowired TransferCoordinator coordinator;
    @Autowired AccountQueryService queries;
    @Autowired AccountRepository accounts;
    @Autowired DemoUserRepository users;
    @Autowired LedgerEntryRepository ledger;
    @Autowired TransferRepository transfers;
    @Autowired AutoTransferRepository autoTransfers;
    @Autowired IdempotencyRecordRepository idempotency;
    @Autowired DemoPersonaCatalog personas;

    private static final BigDecimal OPENING = new BigDecimal("1000000");

    @BeforeEach
    void reset() {
        ledger.deleteAll();
        transfers.deleteAll();
        idempotency.deleteAll();
        autoTransfers.deleteAll();
        accounts.deleteAll();
        users.deleteAll();

        users.saveAll(
                List.of(
                        new DemoUser("u-1", "김순자", "70대", "고령"),
                        new DemoUser("u-8", "박정호", "20대", "청년")));

        accounts.saveAll(
                List.of(
                        new Account("acc-1", "110-234-567890", "김순자", "KRW", Account.Type.ASSET, "u-1"),
                        new Account("acc-2", "110-987-654321", "김순자 적금", "KRW", Account.Type.ASSET, "u-1"),
                        new Account("acc-12", "110-503-100012", "박정호 월급", "KRW", Account.Type.ASSET, "u-8"),
                        // 기관 계좌 — 주인이 없어 아무의 목록에도 '내 통장'으로 안 뜬다.
                        new Account("acc-3", "1002-345-678901", "행복아파트 관리사무소", "KRW"),
                        new Account("acc-open", "000-000-000000", "개시", "KRW", Account.Type.EQUITY)));

        for (String id : List.of("acc-1", "acc-2", "acc-12")) {
            coordinator.transfer(
                    UUID.randomUUID().toString(),
                    new TransferService.Command("acc-open", id, OPENING, "개시 잔액"));
        }
    }

    @Test
    @DisplayName("내 통장 목록에는 내 것만 있다")
    void accountsAreScopedToTheirOwner() {
        assertThat(queries.listAccountsOf("u-1").stream().map(AccountQueryService.AccountView::id))
                .containsExactly("acc-1", "acc-2");
        assertThat(queries.listAccountsOf("u-8").stream().map(AccountQueryService.AccountView::id))
                .containsExactly("acc-12");
        // 기관 계좌는 누구의 것도 아니다.
        assertThat(queries.listAccountsOf("u-1").stream().map(AccountQueryService.AccountView::id))
                .doesNotContain("acc-3");
    }

    @Test
    @DisplayName("사람 사이의 이체가 복식부기로 균형을 유지한다")
    void transferBetweenTwoPeopleStaysBalanced() {
        coordinator.transfer(
                "cross-user-key",
                new TransferService.Command("acc-1", "acc-12", new BigDecimal("30000"), "용돈"));

        assertThat(ledger.balanceOf("acc-1")).isEqualByComparingTo(OPENING.subtract(new BigDecimal("30000")));
        assertThat(ledger.balanceOf("acc-12")).isEqualByComparingTo(OPENING.add(new BigDecimal("30000")));

        // 원장 전체의 차·대변이 여전히 맞는다 — 사람이 늘어도 그것만은 안 바뀐다.
        BigDecimal everyAccount =
                accounts.findAll().stream()
                        .map(account -> ledger.balanceOf(account.getId()))
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(everyAccount).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("받는 쪽 거래내역에 보낸 사람 이름이 남는다")
    void recipientSeesTheIncomingEntry() {
        coordinator.transfer(
                "cross-user-key-2",
                new TransferService.Command("acc-1", "acc-12", new BigDecimal("30000"), "용돈"));

        List<AccountQueryService.TransactionView> incoming =
                queries.listTransactions("acc-12", null, null);

        assertThat(incoming.getFirst().direction()).isEqualTo("in");
        assertThat(incoming.getFirst().counterparty()).isEqualTo("김순자");
    }

    @Test
    @DisplayName("표식을 내면 남의 통장은 403이다")
    void sessionHeaderBlocksOtherPeoplesAccounts() throws Exception {
        mvc.perform(get("/api/accounts/acc-1/transactions").header("X-Demo-Session", "demo-u-1"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isEqualTo(200));

        mvc.perform(get("/api/accounts/acc-1/transactions").header("X-Demo-Session", "demo-u-8"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isEqualTo(403));
    }

    /*
     * 표식을 **안 내면** 지금까지와 똑같이 동작한다. 이 조건부가 이 변경이 자기 범위
     * 밖을 안 건드린다는 근거다 — 기존 통합 테스트와 curl 대본이 그대로 돈다.
     */
    @Test
    @DisplayName("표식이 없으면 지금까지처럼 열려 있다")
    void withoutTheHeaderNothingChanges() throws Exception {
        mvc.perform(get("/api/accounts/acc-1/transactions"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isEqualTo(200));
    }

    /**
     * 브라우저가 다는 헤더를 <b>두 매핑이 모두</b> 받아 주는가.
     *
     * <p>이것으로 한 번 걸렸다. `/api/**`에만 `X-Demo-Session`을 열어 두고 이체가 지나가는
     * `/mock/openbanking/**`에는 안 열어 뒀더니, 프리플라이트가 막혀 <b>이체만</b> 조용히
     * 실패했다. 조회는 전부 되는데 보내기만 안 되니 화면만 보면 이체 로직을 의심하게 된다.
     */
    @Test
    @DisplayName("두 경로 모두 시연 세션 헤더를 CORS로 허용한다")
    void bothMappingsAllowTheSessionHeader() throws Exception {
        for (String path :
                List.of("/api/users/u-1/accounts", "/mock/openbanking/v2.0/transfer/deposit/fin_num")) {
            mvc.perform(
                            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                                    .options(path)
                                    .header("Origin", "http://localhost:5173")
                                    .header("Access-Control-Request-Method", "POST")
                                    .header("Access-Control-Request-Headers", "X-Demo-Session"))
                    .andExpect(
                            result ->
                                    assertThat(result.getResponse().getStatus())
                                            .describedAs("preflight for %s", path)
                                            .isEqualTo(200));
        }
    }

    @Test
    @DisplayName("사용자 목록에 비밀번호 자리가 없다")
    void userListNeverCarriesAPassword() throws Exception {
        String body =
                mvc.perform(get("/api/users"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        assertThat(body).contains("김순자").contains("박정호");
        // 비밀번호라는 개념 자체가 없으므로 그 이름조차 응답에 나오면 안 된다.
        assertThat(body).doesNotContain("pin").doesNotContain("password");
    }

    /**
     * 아는 사람이면 들어가고, 모르는 사람이면 못 들어간다 — <b>그것이 유일한 판단이다.</b>
     *
     * <p>비밀번호를 보내도 서버가 받지 않는다. 받아 두면 언젠가 그것으로 무엇을 하게 되고,
     * 그 순간 이 서버가 지키는 것이 있는 척하게 된다.
     */
    @Test
    @DisplayName("아는 사람이면 비밀번호 없이 들어간다")
    void signInOnlyChecksThatThePersonExists() throws Exception {
        mvc.perform(
                        post("/api/sessions")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"userId\":\"u-1\"}"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isEqualTo(200));

        mvc.perform(
                        post("/api/sessions")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"userId\":\"u-없는사람\"}"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isEqualTo(401));
    }

    /**
     * 처음 쓰는 사람도 누군가에게 보낼 수 있는가.
     *
     * <p>계좌 하나만 놓고 보는 옛 규칙("이 통장에서 보낸 적 있는 곳")이면 순환에 빠진다 —
     * 보낸 적이 있어야 목록에 뜨고, 목록에 떠야 보낼 수 있다. 사람이 열둘로 늘면서
     * 그 순환이 실제 문제가 됐다.
     */
    @Test
    @DisplayName("보낸 적이 없어도 받는 분 목록에 남들이 뜬다")
    void payeesIncludeEveryoneElse() {
        assertThat(
                        // 박정호는 아직 아무에게도 안 보냈다.
                        queries.listAccountsOf("u-8"))
                .hasSize(1);

        List<String> payeeIds =
                new java.util.ArrayList<>(
                        mvcPayees("u-8").stream().toList());

        assertThat(payeeIds).contains("acc-1", "acc-2", "acc-3");
        assertThat(payeeIds).doesNotContain("acc-12");
    }

    private List<String> mvcPayees(String userId) {
        try {
            String body =
                    mvc.perform(get("/api/users/" + userId + "/payees"))
                            .andReturn()
                            .getResponse()
                            .getContentAsString();
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(body).findValuesAsText("id");
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    @Test
    @DisplayName("사람 표는 사람과 계좌를 서로 맞게 가리킨다")
    void personaTableIsConsistent() {
        assertThat(personas.users().size()).isGreaterThanOrEqualTo(10);
        assertThat(personas.holderName("acc-1")).isEqualTo("김순자");
        assertThat(personas.holderName("acc-12")).isEqualTo("박정호");
        // 기관 계좌는 주인이 없어 계좌 이름이 곧 예금주다.
        assertThat(personas.holderName("acc-3")).isEqualTo("행복아파트 관리사무소");
        assertThat(personas.bankCode("acc-6")).isEqualTo("081");
    }
}
