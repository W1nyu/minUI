package com.minui.bank.service;

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

    public AccountQueryService(AccountRepository accounts, LedgerEntryRepository ledger) {
        this.accounts = accounts;
        this.ledger = ledger;
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
