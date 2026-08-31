package com.minui.bank.service;

import com.minui.bank.config.DemoPersonaCatalog;
import com.minui.bank.domain.Account;
import com.minui.bank.domain.LedgerEntry;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 조회 전용. 잔액은 언제나 원장 합계로 구한다 (기획안 §10.1). */
@Service
@Transactional(readOnly = true)
public class AccountQueryService {

    private final AccountRepository accounts;
    private final LedgerEntryRepository ledger;
    private final DemoPersonaCatalog personas;

    public AccountQueryService(
            AccountRepository accounts, LedgerEntryRepository ledger, DemoPersonaCatalog personas) {
        this.accounts = accounts;
        this.ledger = ledger;
        this.personas = personas;
    }

    public record AccountView(
            String id, String number, String nickname, String currency, BigDecimal balance) {}

    /**
     * 거래 내역 한 줄. 잔액(balanceAfter)은 그 시점까지의 누적으로 계산한다.
     *
     * <p>분개에 "그때의 잔액"을 저장해 두지 않는 이유는 그것이 파생 데이터이기 때문이다.
     * 저장해 두면 나중에 과거 분개가 정정될 때 모든 뒤 행이 거짓이 된다.
     */
    public record TransactionView(
            String id,
            Instant at,
            String direction,
            BigDecimal amount,
            String counterparty,
            BigDecimal balanceAfter) {}

    public List<AccountView> listAccounts() {
        return accounts.findAllByOrderByNumberAsc().stream().map(this::toView).toList();
    }

    /**
     * 그 사람의 통장. <b>표에 적힌 순서를 지킨다 — 첫 줄이 주거래 통장이다.</b>
     *
     * <p>계좌번호순으로 정렬하지 않는다. 박정호의 월급 통장({@code acc-12},
     * 110-503-…)이 잘 안 쓰는 통장({@code acc-5}, 110-456-…)보다 번호가 커서, 번호로
     * 줄을 세우면 잔액 카드에 0원짜리 통장이 뜬다. 사람이 쓰는 순서는 표가 안다.
     */
    public List<AccountView> listAccountsOf(String userId) {
        List<String> order = personas.accounts().stream().map(a -> a.id()).toList();
        return accounts.findByOwnerId(userId).stream()
                .sorted(java.util.Comparator.comparingInt(account -> order.indexOf(account.getId())))
                /*
                 * **내 목록에서는 내가 부르는 이름이다.** DB의 nickname은 남이 부르는
                 * 이름("김순자")이라 그대로 쓰면 자기 통장 목록에 자기 이름이 뜬다.
                 * 브라우저 원장이 같은 자리에서 `ownerLabel`을 쓰므로 두 경로가 여기서
                 * 갈리면 "어디서 봤느냐"에 따라 통장 이름이 달라진다.
                 */
                .map(
                        account ->
                                new AccountView(
                                        account.getId(),
                                        account.getNumber(),
                                        personas.ownerLabel(account.getId()),
                                        account.getCurrency(),
                                        ledger.balanceOf(account.getId())))
                .toList();
    }

    public Optional<AccountView> findAccount(String accountId) {
        return accounts.findById(accountId).map(this::toView);
    }

    public List<TransactionView> listTransactions(String accountId, Instant from, Instant to) {
        List<LedgerEntry> entries =
                (from == null || to == null)
                        ? ledger.findByAccountIdOrderByPostedAtDescIdDesc(accountId)
                        : ledger.findByAccountIdAndPostedAtBetweenOrderByPostedAtDescIdDesc(
                                accountId, from, to);

        // 최신순으로 받아 뒤에서부터 누적하면 각 행의 시점 잔액이 나온다.
        BigDecimal running = ledger.balanceOf(accountId);
        List<TransactionView> views = new java.util.ArrayList<>(entries.size());

        for (LedgerEntry entry : entries) {
            views.add(
                    new TransactionView(
                            entry.getId(),
                            entry.getPostedAt(),
                            entry.getSide() == LedgerEntry.Side.DEBIT ? "in" : "out",
                            entry.getAmount(),
                            entry.getCounterparty(),
                            running));
            running = running.subtract(entry.signedAmount());
        }

        return views;
    }

    private AccountView toView(Account account) {
        return new AccountView(
                account.getId(),
                account.getNumber(),
                account.getNickname(),
                account.getCurrency(),
                ledger.balanceOf(account.getId()));
    }
}
