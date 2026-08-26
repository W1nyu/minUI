package com.minui.bank.web;

import com.minui.bank.domain.Account;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.service.AccountQueryService;
import com.minui.bank.service.TransferCoordinator;
import com.minui.bank.service.TransferService;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 공모전·개발용 오픈뱅킹 Mock endpoint.
 *
 * <p>금융결제원 공개 명세의 잔액조회와 핀테크이용번호 기반 입금이체가 쓰는 URL·snake_case
 * JSON 필드·Bearer 흐름을 본뜬다. 실제 openapi.openbanking.or.kr로 나가는 요청, 실제
 * access token, 인증서, 고객 계좌는 <b>전혀 없다.</b> 모든 거래는 이 데모 PostgreSQL 원장에
 * 기록된다. 따라서 "실제 연동"이 아니라 연동 전 UI/거래 흐름 검증용 서버다.
 */
@RestController
@RequestMapping("/mock/openbanking/v2.0")
public class OpenBankingMockController {

    private static final String DEMO_TOKEN = "Bearer demo-session-token";
    private static final DateTimeFormatter DTM =
            DateTimeFormatter.ofPattern("yyyyMMddHHmmssSSS").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter DATE =
            DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC);

    private final AccountRepository accounts;
    private final AccountQueryService queries;
    private final TransferCoordinator transfers;
    private final Clock clock;

    public OpenBankingMockController(
            AccountRepository accounts,
            AccountQueryService queries,
            TransferCoordinator transfers,
            Clock clock) {
        this.accounts = accounts;
        this.queries = queries;
        this.transfers = transfers;
        this.clock = clock;
    }

    /** 금융결제원 잔액조회 API와 같은 GET/조회 파라미터 흐름을 보여 준다. */
    @GetMapping("/account/balance/fin_num")
    public BalanceResponse balance(
            @RequestHeader("Authorization") String authorization,
            @RequestParam("bank_tran_id") String bankTranId,
            @RequestParam("fintech_use_num") String fintechUseNum,
            @RequestParam("tran_dtime") String tranDtime) {
        requireDemoToken(authorization);
        AccountQueryService.AccountView account = accountByFintechUseNumber(fintechUseNum);
        Instant now = clock.instant();
        return new BalanceResponse(
                apiTranId(bankTranId),
                DTM.format(now),
                "A0000",
                "",
                bankTranId,
                DATE.format(now),
                accountIdBankCode(account.id()),
                "000",
                "",
                bankName(account.id()),
                fintechUseNum,
                account.balance().toPlainString(),
                account.balance().toPlainString(),
                account.id().equals("acc-2") ? "2" : "1",
                account.nickname());
    }

    /**
     * 핀테크이용번호 기반 입금이체 Mock. 명세처럼 요청은 한 건(`req_cnt: "1"`)만 받는다.
     *
     * <p>최종 확인을 통과한 호스트만 이 endpoint를 부른다. 음성·sLLM·검색은 절대로
     * 이 컨트롤러를 직접 호출하지 않는다.
     */
    @PostMapping("/transfer/deposit/fin_num")
    public ResponseEntity<DepositResponse> deposit(
            @RequestHeader("Authorization") String authorization,
            @RequestBody DepositRequest request) {
        requireDemoToken(authorization);
        if (!"1".equals(request.req_cnt()) || request.req_list() == null || request.req_list().size() != 1) {
            throw new OpenBankingMockFailure("A1000", "가상 오픈뱅킹은 한 번에 한 건만 처리합니다.");
        }

        DepositLine line = request.req_list().getFirst();
        Account source = accountByPlainNumber(request.cntr_account_num());
        AccountQueryService.AccountView destination = accountByFintechUseNumber(line.fintech_use_num());
        BigDecimal amount;
        try {
            amount = new BigDecimal(line.tran_amt());
        } catch (RuntimeException invalid) {
            throw new OpenBankingMockFailure("A1001", "보낼 금액을 확인해 주세요.");
        }

        TransferService.Result result =
                transfers.transfer(
                        line.bank_tran_id(),
                        new TransferService.Command(
                                source.getId(), destination.id(), amount, line.print_content()));
        Instant now = result.at();
        return ResponseEntity.ok(
                new DepositResponse(
                        result.transferId(),
                        DTM.format(now),
                        "A0000",
                        "",
                        accountIdBankCode(source.getId()),
                        bankName(source.getId()),
                        mask(source.getNumber()),
                        request.wd_print_content(),
                        "김순자",
                        "1",
                        List.of(
                                new DepositLineResponse(
                                        line.tran_no(),
                                        line.bank_tran_id(),
                                        DATE.format(now),
                                        accountIdBankCode(destination.id()),
                                        "000",
                                        "",
                                        fintechUseNumber(destination.id()),
                                        destination.nickname(),
                                        accountIdBankCode(destination.id()),
                                        bankName(destination.id()),
                                        mask(destination.number()),
                                        line.print_content(),
                                        destination.nickname(),
                                        amount.toPlainString()))));
    }

    /** 명세 성공 응답이 공통으로 지니는 거래 정보. */
    public record BalanceResponse(
            String api_tran_id,
            String api_tran_dtm,
            String rsp_code,
            String rsp_message,
            String bank_tran_id,
            String bank_tran_date,
            String bank_code_tran,
            String bank_rsp_code,
            String bank_rsp_message,
            String bank_name,
            String fintech_use_num,
            String balance_amt,
            String available_amt,
            String account_type,
            String product_name) {}

    public record DepositRequest(
            String cntr_account_type,
            String cntr_account_num,
            String wd_pass_phrase,
            String wd_print_content,
            String name_check_option,
            String tran_dtime,
            String req_cnt,
            List<DepositLine> req_list) {}

    public record DepositLine(
            String tran_no,
            String bank_tran_id,
            String fintech_use_num,
            String print_content,
            String tran_amt,
            String req_client_name,
            String req_client_num,
            String transfer_purpose) {}

    public record DepositResponse(
            String api_tran_id,
            String api_tran_dtm,
            String rsp_code,
            String rsp_message,
            String wd_bank_code_std,
            String wd_bank_name,
            String wd_account_num_masked,
            String wd_print_content,
            String wd_account_holder_name,
            String res_cnt,
            List<DepositLineResponse> res_list) {}

    public record DepositLineResponse(
            String tran_no,
            String bank_tran_id,
            String bank_tran_date,
            String bank_code_tran,
            String bank_rsp_code,
            String bank_rsp_message,
            String fintech_use_num,
            String account_alias,
            String bank_code_std,
            String bank_name,
            String account_num_masked,
            String print_content,
            String account_holder_name,
            String tran_amt) {}

    private AccountQueryService.AccountView accountByFintechUseNumber(String fintechUseNum) {
        String accountId = accountIdFromFintechUseNumber(fintechUseNum);
        return queries
                .findAccount(accountId)
                .orElseThrow(() -> new OpenBankingMockFailure("A1002", "가상 핀테크이용번호를 찾을 수 없습니다."));
    }

    private Account accountByPlainNumber(String number) {
        String normalized = number.replaceAll("[^0-9]", "");
        return accounts.findAll().stream()
                .filter(account -> account.getNumber().replaceAll("[^0-9]", "").equals(normalized))
                .findFirst()
                .orElseThrow(() -> new OpenBankingMockFailure("A1003", "가상 출금계좌를 찾을 수 없습니다."));
    }

    private static void requireDemoToken(String authorization) {
        if (!DEMO_TOKEN.equals(authorization)) {
            throw new OpenBankingMockFailure("A1004", "가상 OAuth 동의를 확인해 주세요.");
        }
    }

    /** `acc-6` → 24자리 고정 핀테크이용번호. DB에 실계좌 식별자를 추가하지 않는다. */
    private static String fintechUseNumber(String accountId) {
        int suffix = accountSuffix(accountId);
        return String.format("110000000000000000%06d", suffix);
    }

    private static String accountIdFromFintechUseNumber(String fintechUseNum) {
        if (!fintechUseNum.matches("110000000000000000\\d{6}")) {
            throw new OpenBankingMockFailure("A1002", "가상 핀테크이용번호를 찾을 수 없습니다.");
        }
        return "acc-" + Integer.parseInt(fintechUseNum.substring(fintechUseNum.length() - 6));
    }

    private static int accountSuffix(String accountId) {
        if (!accountId.startsWith("acc-")) {
            throw new OpenBankingMockFailure("A1002", "가상 계좌만 사용할 수 있습니다.");
        }
        try {
            return Integer.parseInt(accountId.substring(4));
        } catch (NumberFormatException invalid) {
            throw new OpenBankingMockFailure("A1002", "가상 계좌만 사용할 수 있습니다.");
        }
    }

    private static String accountIdBankCode(String accountId) {
        return accountId.equals("acc-4") ? "004" : accountId.equals("acc-3") ? "020" : accountId.equals("acc-6") ? "081" : "088";
    }

    private static String bankName(String accountId) {
        return accountId.equals("acc-4") ? "국민은행" : accountId.equals("acc-3") ? "행복은행" : accountId.equals("acc-6") ? "하나은행" : "미니은행";
    }

    private static String mask(String number) {
        String plain = number.replaceAll("[^0-9]", "");
        return plain.substring(0, 3) + "-" + plain.substring(3, 7) + "-****" + plain.substring(plain.length() - 2);
    }

    private static String apiTranId(String bankTranId) {
        return "mock-" + bankTranId;
    }

    /** 실제 API 오류 코드가 아니라 이 서버가 낸 시연용 거절임을 명시하기 위한 예외다. */
    public static class OpenBankingMockFailure extends RuntimeException {
        private final String code;

        OpenBankingMockFailure(String code, String message) {
            super(message);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }
}
