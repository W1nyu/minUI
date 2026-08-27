package com.minui.bank;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.minui.bank.domain.Account;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.IdempotencyRecordRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import com.minui.bank.repository.TransferRepository;
import com.minui.bank.service.TransferCoordinator;
import com.minui.bank.service.TransferService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 실제 금융결제원에 닿지 않는다는 전제에서, 공개 명세와 같은 요청 모양이 원장까지
 * 이어지는지만 검증한다. 음성/모델이 호출하는 테스트가 아니라 최종 확인 뒤의 호스트 경로다.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OpenBankingMockApiTest {

    @Autowired MockMvc mvc;
    @Autowired AccountRepository accounts;
    @Autowired LedgerEntryRepository ledger;
    @Autowired TransferRepository transfers;
    @Autowired IdempotencyRecordRepository idempotency;
    @Autowired TransferCoordinator coordinator;

    @BeforeEach
    void reset() {
        ledger.deleteAll();
        transfers.deleteAll();
        idempotency.deleteAll();
        accounts.deleteAll();
        accounts.saveAll(
                List.of(
                        new Account("acc-1", "110-234-567890", "주거래 통장", "KRW"),
                        new Account("acc-6", "356-910-234567", "김영수 삼촌", "KRW"),
                        new Account("acc-open", "000-000-000000", "개시 분개", "KRW", Account.Type.EQUITY)));
        coordinator.transfer(
                UUID.randomUUID().toString(),
                new TransferService.Command("acc-open", "acc-1", new BigDecimal("1000000"), "개시"));
    }

    @Test
    void kftcShapeDepositRequestChangesOnlyTheDemoLedger() throws Exception {
        mvc.perform(
                        post("/mock/openbanking/v2.0/transfer/deposit/fin_num")
                                .header("Authorization", "Bearer demo-session-token")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "cntr_account_type":"N",
                                          "cntr_account_num":"110234567890",
                                          "wd_pass_phrase":"DEMO_ONLY",
                                          "wd_print_content":"용돈",
                                          "name_check_option":"on",
                                          "tran_dtime":"20260826010101",
                                          "req_cnt":"1",
                                          "req_list":[{
                                            "tran_no":"1",
                                            "bank_tran_id":"FMOCK000000000000001",
                                            "fintech_use_num":"110000000000000000000006",
                                            "print_content":"용돈",
                                            "tran_amt":"30000",
                                            "req_client_name":"김순자",
                                            "req_client_num":"MINUI-DEMO-USER",
                                            "transfer_purpose":"TR"
                                          }]
                                        }
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rsp_code").value("A0000"))
                .andExpect(jsonPath("$.res_cnt").value("1"))
                .andExpect(jsonPath("$.res_list[0].account_alias").value("김영수 삼촌"))
                .andExpect(jsonPath("$.res_list[0].tran_amt").value("30000"));

        assertThat(ledger.balanceOf("acc-1")).isEqualByComparingTo("970000");
        assertThat(ledger.balanceOf("acc-6")).isEqualByComparingTo("30000");
        assertThat(ledger.debitAndCreditTotals().getFirst()[0])
                .isEqualTo(ledger.debitAndCreditTotals().getFirst()[1]);
    }

    // ── 오류 계약 ────────────────────────────────────────────────────────
    //
    // 이 데모에는 가상 원장이 둘이다 — 여기(PostgreSQL)와 정적 배포의 sessionStorage.
    // 성공 경로는 양쪽 다 확인해 왔지만 **거절하는 경우는 아무도 대조하지 않았다.**
    // 갈라지면 어디서 봤느냐에 따라 다른 결과가 나오고, 시연에서 그것은 최악이다.
    //
    // 아래는 `shared/contracts/openbanking-cases.json`을 읽는다. 같은 표를
    // `frontend/test/openBankingErrors.test.ts`도 읽으므로, 한쪽만 고치면 다른 쪽이 걸린다.

    private static final Path CONTRACT_PATH =
            Path.of("..", "shared", "contracts", "openbanking-cases.json");

    /** 표가 정한 그 경우의 거절 이유(정규식). */
    private String saysFor(String caseId) throws Exception {
        JsonNode contract = new ObjectMapper().readTree(Files.readString(CONTRACT_PATH));
        for (JsonNode item : contract.get("cases")) {
            if (caseId.equals(item.get("id").asText())) {
                assertThat(item.get("outcome").asText())
                        .as("표에서 %s는 거절이어야 한다", caseId)
                        .isEqualTo("refused");
                return item.get("says").asText();
            }
        }
        throw new IllegalStateException("계약 표에 " + caseId + "가 없다");
    }

    /** 정상 전문 하나. 각 경우는 여기서 한 군데씩만 비튼다. */
    private String deposit(String bankTranId, String fintechUseNum, String amount) {
        return """
               {
                 "cntr_account_type":"N",
                 "cntr_account_num":"110234567890",
                 "wd_pass_phrase":"DEMO_ONLY",
                 "wd_print_content":"대조",
                 "name_check_option":"on",
                 "tran_dtime":"20260827120000",
                 "req_cnt":"1",
                 "req_list":[{
                   "tran_no":"1",
                   "bank_tran_id":"%s",
                   "fintech_use_num":"%s",
                   "print_content":"대조",
                   "tran_amt":"%s",
                   "req_client_name":"김순자",
                   "req_client_num":"MINUI-DEMO-USER",
                   "transfer_purpose":"TR"
                 }]
               }
               """
                .formatted(bankTranId, fintechUseNum, amount);
    }

    /** 거절했고, 표가 정한 이유를 말했고, **원장이 그대로인지**까지 본다. */
    private void refuses(String caseId, String token, String body) throws Exception {
        BigDecimal before = ledger.balanceOf("acc-1");

        String message =
                mvc.perform(
                                post("/mock/openbanking/v2.0/transfer/deposit/fin_num")
                                        .header("Authorization", token)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().is4xxClientError())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        assertThat(Pattern.compile(saysFor(caseId)).matcher(message).find())
                .as("%s: 이유가 표와 다르다 — %s", caseId, message)
                .isTrue();

        // 거절했는데 일부라도 빠져 있으면, 그것이 이 Mock이 할 수 있는 가장 나쁜 실수다.
        assertThat(ledger.balanceOf("acc-1")).isEqualByComparingTo(before);
    }

    @Test
    void refusesWhenBalanceIsNotEnough() throws Exception {
        refuses(
                "insufficient-balance",
                "Bearer demo-session-token",
                deposit("FMOCK000000000000101", "110000000000000000000006", "99999999"));
    }

    @Test
    void refusesUnknownFintechUseNumber() throws Exception {
        refuses(
                "unknown-fintech-number",
                "Bearer demo-session-token",
                deposit("FMOCK000000000000102", "110000000000000000999999", "30000"));
    }

    @Test
    void refusesBadAccessToken() throws Exception {
        refuses(
                "bad-token",
                "Bearer 남의-토큰",
                deposit("FMOCK000000000000103", "110000000000000000000006", "30000"));
    }

    @Test
    void refusesZeroAmount() throws Exception {
        refuses(
                "zero-amount",
                "Bearer demo-session-token",
                deposit("FMOCK000000000000104", "110000000000000000000006", "0"));
    }

    /** 같은 은행거래 키로 다시 보내도 한 번만 빠진다. 정적 Mock과 같은 약속이다. */
    @Test
    void sameBankTranIdWithdrawsOnce() throws Exception {
        String body = deposit("FMOCK000000000000105", "110000000000000000000006", "50000");
        for (int attempt = 0; attempt < 2; attempt += 1) {
            mvc.perform(
                            post("/mock/openbanking/v2.0/transfer/deposit/fin_num")
                                    .header("Authorization", "Bearer demo-session-token")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.rsp_code").value("A0000"));
        }
        assertThat(ledger.balanceOf("acc-1")).isEqualByComparingTo("950000");
        assertThat(ledger.balanceOf("acc-6")).isEqualByComparingTo("50000");
    }
}
