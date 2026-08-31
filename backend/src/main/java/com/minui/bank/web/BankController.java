package com.minui.bank.web;

import com.minui.bank.service.AccountQueryService;
import com.minui.bank.service.BankingExtrasService;
import com.minui.bank.service.DemoSessionService;
import com.minui.bank.service.TransferCoordinator;
import com.minui.bank.service.TransferService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class BankController {

    private final AccountQueryService queries;
    private final TransferCoordinator transfers;
    private final BankingExtrasService extras;
    private final DemoSessionService sessions;

    public BankController(
            AccountQueryService queries,
            TransferCoordinator transfers,
            BankingExtrasService extras,
            DemoSessionService sessions) {
        this.queries = queries;
        this.transfers = transfers;
        this.extras = extras;
        this.sessions = sessions;
    }

    /* ── 시연용 사람 ─────────────────────────────────────────────────────
     *
     * 로그인 화면이 쓰는 세 가지. **비밀번호는 주고받지 않는다** — 아예 없다.
     * 이 표식은 인증이 아니다 — `DemoSessionService`의 주석을 볼 것.
     */

    @GetMapping("/users")
    public List<DemoSessionService.UserView> listUsers() {
        return sessions.listUsers();
    }

    /** 비밀번호 칸이 없다. 받아 두면 언젠가 그것으로 무엇을 하게 된다. */
    public record SignIn(@NotBlank String userId) {}

    /**
     * 들어간 뒤 화면이 곧바로 필요로 하는 것까지 함께 준다.
     *
     * <p>{@code accounts}가 있는 이유: 로그인 직후 화면이 하는 첫 일이 통장 목록을 그리는
     * 것이라, 이것을 빼면 어느 클라이언트든 곧장 한 번을 더 부른다.
     */
    public record Session(
            String token,
            DemoSessionService.UserView user,
            List<AccountQueryService.AccountView> accounts) {}

    @PostMapping("/sessions")
    public ResponseEntity<?> signIn(@Valid @RequestBody SignIn request) {
        return sessions
                .signIn(request.userId())
                .<ResponseEntity<?>>map(
                        token ->
                                ResponseEntity.ok(
                                        new Session(
                                                token,
                                                sessions.listUsers().stream()
                                                        .filter(u -> u.id().equals(request.userId()))
                                                        .findFirst()
                                                        .orElse(null),
                                                queries.listAccountsOf(request.userId()))))
                .orElseGet(
                        () ->
                                ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                                        .body(java.util.Map.of("message", "그런 사람이 없어요.")));
    }

    @GetMapping("/users/{userId}/accounts")
    public List<AccountQueryService.AccountView> listUserAccounts(@PathVariable String userId) {
        return queries.listAccountsOf(userId);
    }

    @GetMapping("/users/{userId}/auto-transfers")
    public List<BankingExtrasService.AutoTransferView> listUserAutoTransfers(
            @PathVariable String userId) {
        return extras.listAutoTransfersOf(userId);
    }

    @GetMapping("/users/{userId}/payees")
    public List<BankingExtrasService.PayeeView> listUserPayees(@PathVariable String userId) {
        return extras.listRecentPayeesOf(userId);
    }

    @GetMapping("/users/{userId}/upcoming-deposits")
    public List<BankingExtrasService.UpcomingDepositView> listUserUpcomingDeposits(
            @PathVariable String userId) {
        return extras.listUpcomingDepositsOf(userId);
    }

    @GetMapping("/accounts/{accountId}/auto-transfers")
    public List<BankingExtrasService.AutoTransferView> listAutoTransfers(
            @PathVariable String accountId) {
        return extras.listAutoTransfers(accountId);
    }

    public record AutoTransferUpdate(boolean active) {}

    @PostMapping("/auto-transfers/{autoTransferId}")
    public ResponseEntity<Void> setAutoTransferActive(
            @PathVariable String autoTransferId, @RequestBody AutoTransferUpdate update) {
        extras.setActive(autoTransferId, update.active());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/accounts/{accountId}/payees")
    public List<BankingExtrasService.PayeeView> listPayees(@PathVariable String accountId) {
        return extras.listRecentPayees(accountId);
    }

    @GetMapping("/accounts/{accountId}/upcoming-deposits")
    public List<BankingExtrasService.UpcomingDepositView> listUpcomingDeposits(
            @PathVariable String accountId) {
        return extras.listUpcomingDeposits(accountId);
    }

    @GetMapping("/accounts")
    public List<AccountQueryService.AccountView> listAccounts() {
        return queries.listAccounts();
    }

    @GetMapping("/accounts/{accountId}")
    public ResponseEntity<AccountQueryService.AccountView> getAccount(
            @PathVariable String accountId) {
        return queries.findAccount(accountId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/accounts/{accountId}/transactions")
    public List<AccountQueryService.TransactionView> listTransactions(
            @PathVariable String accountId,
            @RequestParam(required = false)
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false)
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {
        return queries.listTransactions(accountId, from, to);
    }

    public record TransferRequest(
            @NotBlank String fromAccountId,
            @NotBlank String toAccountId,
            @NotNull @Positive BigDecimal amount,
            String memo) {}

    /**
     * 이체.
     *
     * <p>{@code Idempotency-Key}는 <b>필수</b>다. 선택으로 두면 클라이언트가 빠뜨리기 쉽고,
     * 빠뜨린 요청은 네트워크가 끊길 때 중복 이체가 된다. 서버가 대신 키를 만들어 주는
     * 방법도 안 된다 — 재시도인지 새 요청인지는 클라이언트만 안다.
     */
    @PostMapping("/transfers")
    public ResponseEntity<TransferResponse> transfer(
            @RequestHeader("Idempotency-Key") @NotBlank String idempotencyKey,
            @Valid @RequestBody TransferRequest request) {

        TransferService.Result result =
                transfers.transfer(
                        idempotencyKey,
                        new TransferService.Command(
                                request.fromAccountId(),
                                request.toAccountId(),
                                request.amount(),
                                request.memo()));

        return ResponseEntity.status(result.replayed() ? HttpStatus.OK : HttpStatus.CREATED)
                .body(
                        new TransferResponse(
                                result.transferId(),
                                result.at(),
                                result.amount(),
                                result.counterparty(),
                                result.balanceAfter(),
                                result.replayed()));
    }

    public record TransferResponse(
            String id,
            Instant at,
            BigDecimal amount,
            String counterparty,
            BigDecimal balanceAfter,
            boolean replayed) {}
}
