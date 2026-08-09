package com.minui.bank.config;

import com.minui.bank.domain.Account;
import com.minui.bank.domain.AutoTransfer;
import com.minui.bank.domain.LedgerEntry;
import com.minui.bank.domain.Transfer;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.AutoTransferRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import com.minui.bank.repository.TransferRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 데모 초기 데이터. 페르소나 A(김순자, 73세, 연금 수령자)의 통장을 재현한다.
 *
 * <p>여는 잔액도 분개로 넣는다. "개시 분개"라는 상대 계좌를 두어 차·대변이 맞게 하는데,
 * 이게 번거로워 보여도 잔액 컬럼을 두는 것보다 낫다 — 원장 밖에서 만들어진 돈이 하나도
 * 없다는 것이 감사 질의 하나로 확인된다.
 */
@Component
@Profile("!test")
public class DemoDataLoader implements CommandLineRunner {

    private static final String OPENING = "acc-opening";

    private final AccountRepository accounts;
    private final LedgerEntryRepository ledger;
    private final TransferRepository transfers;
    private final AutoTransferRepository autoTransfers;

    public DemoDataLoader(
            AccountRepository accounts,
            LedgerEntryRepository ledger,
            TransferRepository transfers,
            AutoTransferRepository autoTransfers) {
        this.accounts = accounts;
        this.ledger = ledger;
        this.transfers = transfers;
        this.autoTransfers = autoTransfers;
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (accounts.count() > 0) {
            return;
        }

        accounts.saveAll(
                List.of(
                        new Account("acc-1", "110-234-567890", "주거래 통장", "KRW"),
                        new Account("acc-2", "110-987-654321", "적금 통장", "KRW"),
                        new Account("acc-3", "1002-345-678901", "행복아파트 관리사무소", "KRW"),
                        new Account("acc-4", "612-21-0987-654", "김미영", "KRW"),
                        new Account("acc-5", "110-456-789012", "박정호", "KRW"),
                        new Account(
                                OPENING,
                                "000-000-000000",
                                "개시 분개",
                                "KRW",
                                Account.Type.EQUITY)));

        open("acc-1", new BigDecimal("631500"), Instant.parse("2026-07-01T00:00:00Z"));
        open("acc-2", new BigDecimal("6100000"), Instant.parse("2026-07-01T00:00:00Z"));
        open("acc-3", new BigDecimal("0.01"), Instant.parse("2026-07-01T00:00:00Z"));
        open("acc-4", new BigDecimal("0.01"), Instant.parse("2026-07-01T00:00:00Z"));
        open("acc-5", new BigDecimal("0.01"), Instant.parse("2026-07-01T00:00:00Z"));

        // 연금 입금 — 기획안 §5.1의 "연금 입금 확인" 시나리오가 볼 거래.
        // 두 달치를 넣는 이유는 입금 예정 계산이 서로 다른 달의 관측을 요구하기 때문이다.
        post(OPENING, "acc-1", new BigDecimal("612000"), "국민연금공단",
                Instant.parse("2026-07-05T00:11:00Z"));
        post(OPENING, "acc-1", new BigDecimal("612000"), "국민연금공단",
                Instant.parse("2026-08-05T00:12:00Z"));

        // 관리비 이체 — 시나리오 S1의 "매달 25일 관리비"
        post(
                "acc-1",
                "acc-3",
                new BigDecimal("187000"),
                "행복아파트 관리사무소",
                Instant.parse("2026-07-25T01:03:00Z"));
        post("acc-1", "acc-4", new BigDecimal("50000"), "김미영",
                Instant.parse("2026-07-18T05:40:00Z"));

        autoTransfers.saveAll(
                List.of(
                        new AutoTransfer(
                                UUID.randomUUID().toString(), "acc-1", "acc-3",
                                "행복아파트 관리사무소", new BigDecimal("187000"), 25, true),
                        new AutoTransfer(
                                UUID.randomUUID().toString(), "acc-1", "acc-5",
                                "한국전력공사", new BigDecimal("42300"), 18, true),
                        new AutoTransfer(
                                UUID.randomUUID().toString(), "acc-1", "acc-5",
                                "실버케어 보험", new BigDecimal("68000"), 10, false)));
    }

    private void open(String accountId, BigDecimal amount, Instant at) {
        post(OPENING, accountId, amount, "개시 잔액", at);
    }

    /** 한 건의 이체를 분개 두 줄로 기록한다. */
    private void post(String fromId, String toId, BigDecimal amount, String label, Instant at) {
        String transferId = UUID.randomUUID().toString();

        List<LedgerEntry> entries =
                List.of(
                        new LedgerEntry(
                                UUID.randomUUID().toString(),
                                fromId,
                                transferId,
                                LedgerEntry.Side.CREDIT,
                                amount,
                                label,
                                at),
                        new LedgerEntry(
                                UUID.randomUUID().toString(),
                                toId,
                                transferId,
                                LedgerEntry.Side.DEBIT,
                                amount,
                                label,
                                at));

        Transfer.assertBalanced(entries);
        transfers.save(new Transfer(transferId, fromId, toId, amount, label, at));
        ledger.saveAll(entries);
    }
}
