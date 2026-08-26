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
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
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
}
