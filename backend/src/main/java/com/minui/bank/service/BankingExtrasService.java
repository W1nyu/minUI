package com.minui.bank.service;

import com.minui.bank.domain.Account;
import com.minui.bank.domain.AutoTransfer;
import com.minui.bank.domain.Transfer;
import com.minui.bank.domain.LedgerEntry;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.AutoTransferRepository;
import com.minui.bank.repository.TransferRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 자동이체·최근 수취인·입금 예정.
 *
 * <p>최근 수취인과 입금 예정은 <b>저장하지 않고 원장에서 도출한다.</b> 별도 테이블을 두면
 * 원장과 어긋날 수 있는 두 번째 진실이 생긴다. "최근 보낸 곳"의 정의가 곧 "최근에 출금
 * 분개가 있었던 상대"이므로, 그 정의를 그대로 질의로 옮기는 편이 정확하다.
 */
@Service
@Transactional(readOnly = true)
public class BankingExtrasService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final AutoTransferRepository autoTransfers;
    private final LedgerEntryRepository ledger;
    private final TransferRepository transfers;
    private final AccountRepository accounts;
    private final Clock clock;

    public BankingExtrasService(
            AutoTransferRepository autoTransfers,
            LedgerEntryRepository ledger,
            TransferRepository transfers,
            AccountRepository accounts,
            Clock clock) {
        this.autoTransfers = autoTransfers;
        this.ledger = ledger;
        this.transfers = transfers;
        this.accounts = accounts;
        this.clock = clock;
    }

    public record AutoTransferView(
            String id, String payee, BigDecimal amount, int dayOfMonth, boolean active) {}

    /** {@code id}는 수취인의 계좌 ID다. 이체 요청이 그대로 쓸 수 있어야 한다. */
    public record PayeeView(String id, String name, String number, String lastSentAt) {}

    public record UpcomingDepositView(
            String id, String label, String expectedAt, BigDecimal amount) {}

    /** 한 번도 안 보낸 상대의 "마지막으로 보낸 때". 목록 맨 뒤로 가라는 뜻이다. */
    private static final String EPOCH = "1970-01-01T00:00:00Z";

    public List<AutoTransferView> listAutoTransfers(String accountId) {
        return autoTransfers.findByFromAccountIdOrderByDayOfMonthAsc(accountId).stream()
                .map(
                        a ->
                                new AutoTransferView(
                                        a.getId(),
                                        a.getPayee(),
                                        a.getAmount(),
                                        a.getDayOfMonth(),
                                        a.isActive()))
                .toList();
    }

    /** 그 사람의 모든 통장에서 나가는 자동이체. 통장이 여럿이면 합쳐 보여 준다. */
    public List<AutoTransferView> listAutoTransfersOf(String userId) {
        return accounts.findByOwnerId(userId).stream()
                .flatMap(account -> listAutoTransfers(account.getId()).stream())
                .toList();
    }

    /**
     * 그 사람이 보낼 수 있는 상대 — <b>내 것이 아닌 통장 전부.</b>
     *
     * <p>계좌 하나만 놓고 보는 {@link #listRecentPayees(String)}와 다르게 판단한다.
     * 저쪽은 "이 통장에서 보낸 적 있는 곳"을 뽑는데, 그 규칙이면 <b>처음 쓰는 사람은
     * 아무에게도 못 보낸다</b> — 보낸 적이 있어야 목록에 뜨고, 목록에 떠야 보낼 수 있는
     * 순환이다. 사람이 열둘로 늘면서 그 순환이 실제 문제가 됐다.
     *
     * <p>브라우저 원장이 하던 것과 같아진다는 점도 중요하다. 두 원장이 다른 목록을 주면
     * "어디서 봤느냐"에 따라 보낼 수 있는 사람이 달라진다.
     */
    public List<PayeeView> listRecentPayeesOf(String userId) {
        Map<String, String> lastSentByAccount = new LinkedHashMap<>();
        for (Account mine : accounts.findByOwnerId(userId)) {
            for (PayeeView sent : listRecentPayees(mine.getId())) {
                lastSentByAccount.merge(
                        sent.id(),
                        sent.lastSentAt(),
                        (left, right) -> left.compareTo(right) >= 0 ? left : right);
            }
        }

        return accounts.findAllByOrderByNumberAsc().stream()
                .filter(account -> account.getType() == Account.Type.ASSET)
                .filter(account -> !account.isOwnedBy(userId))
                .map(
                        account ->
                                new PayeeView(
                                        account.getId(),
                                        account.getNickname(),
                                        account.getNumber(),
                                        lastSentByAccount.getOrDefault(
                                                account.getId(), EPOCH)))
                .sorted(Comparator.comparing(PayeeView::lastSentAt).reversed())
                .toList();
    }

    public List<UpcomingDepositView> listUpcomingDepositsOf(String userId) {
        return accounts.findByOwnerId(userId).stream()
                .flatMap(account -> listUpcomingDeposits(account.getId()).stream())
                .toList();
    }

    @Transactional
    public void setActive(String autoTransferId, boolean active) {
        autoTransfers
                .findById(autoTransferId)
                .ifPresent(autoTransfer -> autoTransfer.setActive(active));
    }

    /**
     * 최근에 돈을 보낸 상대.
     *
     * <p>분개가 아니라 <b>이체 기록</b>에서 뽑는다. 분개의 {@code counterparty}는 화면에
     * 보여 줄 이름 문자열일 뿐이라 계좌를 식별하지 못한다. 이체 기록에는 받는 계좌 ID가
     * 있으므로, 여기서 나온 수취인을 그대로 다음 이체 요청에 쓸 수 있다.
     */
    public List<PayeeView> listRecentPayees(String accountId) {
        Map<String, PayeeView> latestByAccount = new LinkedHashMap<>();

        for (Transfer transfer : transfers.findByFromAccountIdOrderByCreatedAtDesc(accountId)) {
            if (latestByAccount.containsKey(transfer.getToAccountId())) {
                continue;
            }
            accounts
                    .findById(transfer.getToAccountId())
                    .filter(account -> account.getType() == Account.Type.ASSET)
                    .ifPresent(
                            account ->
                                    latestByAccount.put(
                                            account.getId(),
                                            new PayeeView(
                                                    account.getId(),
                                                    account.getNickname(),
                                                    account.getNumber(),
                                                    transfer.getCreatedAt().toString())));
        }

        return new ArrayList<>(latestByAccount.values());
    }

    /**
     * 입금 예정. 같은 상대에게서 <b>서로 다른 달에</b> 두 번 이상 입금이 있었으면
     * 주기적인 것으로 보고 다음 달의 같은 날짜를 예상한다.
     *
     * <p>한 달 안에 여러 번 들어온 것을 주기로 세지 않는 것은 엔진의 contextBoost와 같은
     * 이유다 — 한 시점에 몰린 사건은 주기의 근거가 되지 못한다.
     */
    public List<UpcomingDepositView> listUpcomingDeposits(String accountId) {
        Map<String, List<LedgerEntry>> incomingByCounterparty = new LinkedHashMap<>();

        for (LedgerEntry entry : ledger.findByAccountIdOrderByPostedAtDescIdDesc(accountId)) {
            if (entry.getSide() != LedgerEntry.Side.DEBIT) {
                continue;
            }
            incomingByCounterparty
                    .computeIfAbsent(entry.getCounterparty(), k -> new ArrayList<>())
                    .add(entry);
        }

        LocalDate today = LocalDate.ofInstant(clock.instant(), KST);
        List<UpcomingDepositView> upcoming = new ArrayList<>();

        for (Map.Entry<String, List<LedgerEntry>> e : incomingByCounterparty.entrySet()) {
            List<LedgerEntry> entries = e.getValue();
            long distinctMonths =
                    entries.stream()
                            .map(x -> YearMonth.from(LocalDate.ofInstant(x.getPostedAt(), KST)))
                            .distinct()
                            .count();
            if (distinctMonths < 2) {
                continue;
            }

            LedgerEntry latest =
                    entries.stream()
                            .max(Comparator.comparing(LedgerEntry::getPostedAt))
                            .orElseThrow();
            LocalDate latestDate = LocalDate.ofInstant(latest.getPostedAt(), KST);
            LocalDate next = nextOccurrence(today, latestDate.getDayOfMonth());

            upcoming.add(
                    new UpcomingDepositView(
                            latest.getId(),
                            e.getKey(),
                            next.atStartOfDay(KST).toInstant().toString(),
                            latest.getAmount()));
        }

        return upcoming;
    }

    /** 오늘 이후로 가장 가까운 해당 일자. 그 달에 그 날짜가 없으면 말일로 당긴다. */
    private LocalDate nextOccurrence(LocalDate today, int dayOfMonth) {
        YearMonth month = YearMonth.from(today);
        LocalDate candidate = month.atDay(Math.min(dayOfMonth, month.lengthOfMonth()));

        if (!candidate.isAfter(today)) {
            YearMonth nextMonth = month.plusMonths(1);
            candidate = nextMonth.atDay(Math.min(dayOfMonth, nextMonth.lengthOfMonth()));
        }
        return candidate;
    }

    /** 데모 시드가 쓴다. */
    @Transactional
    public void register(AutoTransfer autoTransfer) {
        autoTransfers.save(autoTransfer);
    }

    public long count() {
        return autoTransfers.count();
    }

    public Instant now() {
        return clock.instant();
    }
}
