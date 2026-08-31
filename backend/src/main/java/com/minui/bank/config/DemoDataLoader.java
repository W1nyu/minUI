package com.minui.bank.config;

import com.minui.bank.domain.Account;
import com.minui.bank.domain.AutoTransfer;
import com.minui.bank.domain.DemoSeed;
import com.minui.bank.domain.DemoUser;
import com.minui.bank.domain.LedgerEntry;
import com.minui.bank.domain.Transfer;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.AutoTransferRepository;
import com.minui.bank.repository.DemoSeedRepository;
import com.minui.bank.repository.DemoUserRepository;
import com.minui.bank.repository.IdempotencyRecordRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import com.minui.bank.repository.TransferRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 데모 초기 데이터.
 *
 * <p>사람과 계좌는 {@link DemoPersonaCatalog}가 읽는 {@code shared/contracts/demo-users.json}
 * 에서 온다 — <b>브라우저 원장과 같은 파일이다.</b> 전에는 이 파일 안에 일곱 계좌가 박혀
 * 있었고 프런트에도 같은 여섯이 따로 박혀 있어서, 한쪽만 고치면 조용히 갈라졌다.
 *
 * <p>여는 잔액도 분개로 넣는다. "개시 분개"라는 상대 계좌를 두어 차·대변이 맞게 하는데,
 * 이게 번거로워 보여도 잔액 컬럼을 두는 것보다 낫다 — 원장 밖에서 만들어진 돈이 하나도
 * 없다는 것이 감사 질의 하나로 확인된다.
 *
 * <p><b>표의 판 번호가 올라가면 데모 데이터를 지우고 다시 깐다.</b> 전에는
 * {@code accounts.count() > 0}이면 그냥 돌아 나갔는데, 그러면 사람을 늘려도 기존
 * 개발 DB에는 영영 안 들어온다. 지우는 것은 이 가상 원장의 데이터뿐이고, 지웠다는
 * 사실을 로그에 남긴다.
 */
@Component
@Profile("!test")
public class DemoDataLoader implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataLoader.class);
    private static final String OPENING = "acc-opening";

    private final DemoPersonaCatalog personas;
    private final AccountRepository accounts;
    private final LedgerEntryRepository ledger;
    private final TransferRepository transfers;
    private final AutoTransferRepository autoTransfers;
    private final IdempotencyRecordRepository idempotency;
    private final DemoUserRepository users;
    private final DemoSeedRepository seeds;

    @PersistenceContext private EntityManager entityManager;

    public DemoDataLoader(
            DemoPersonaCatalog personas,
            AccountRepository accounts,
            LedgerEntryRepository ledger,
            TransferRepository transfers,
            AutoTransferRepository autoTransfers,
            IdempotencyRecordRepository idempotency,
            DemoUserRepository users,
            DemoSeedRepository seeds) {
        this.personas = personas;
        this.accounts = accounts;
        this.ledger = ledger;
        this.transfers = transfers;
        this.autoTransfers = autoTransfers;
        this.idempotency = idempotency;
        this.users = users;
        this.seeds = seeds;
    }

    @Override
    @Transactional
    public void run(String... args) {
        int current = personas.version();
        DemoSeed marker = seeds.findById(DemoSeed.SINGLETON).orElse(null);
        int installed = marker == null ? 0 : marker.getVersion();

        if (installed == current && accounts.count() > 0) {
            return;
        }

        if (accounts.count() > 0) {
            /*
             * 크게 말하고 지운다. 조용히 지우면 "내가 만든 이체가 왜 사라졌지"를
             * 아무도 설명할 수 없다. 지워지는 것은 이 가상 원장뿐이다.
             */
            log.warn(
                    "시연 데이터 판이 {} → {}로 올라가 데모 원장을 다시 깝니다. "
                            + "이 가상 원장의 계좌·분개·이체 기록이 지워집니다.",
                    installed,
                    current);
            wipe();
        }

        dropRetiredColumns();
        seedUsers();
        seedAccounts();
        seedHistory();
        seedAutoTransfers();
        if (marker == null) seeds.save(new DemoSeed(current));
        else marker.moveTo(current);
        log.info(
                "시연 데이터 판 {}: 사람 {}명 · 계좌 {}개",
                current,
                personas.users().size(),
                personas.accounts().size() + 1);
    }

    /**
     * 없어진 칸을 실제로 지운다.
     *
     * <p>{@code ddl-auto=update}는 컬럼을 <b>더하기만 하고 지우지 않는다.</b> 그래서
     * 엔티티에서 {@code pin}을 뺐을 때, 기존 개발 DB에는 {@code not null}인 {@code pin}
     * 컬럼이 그대로 남아 시드가 통째로 죽었다 — 서버가 아예 안 떴다.
     *
     * <p>이 데모의 대응은 "볼륨을 지우고 다시 받으세요"가 아니라 여기서 치우는 것이다.
     * 개발용 볼륨을 안 지우고 쓰는 것이 정상 흐름이라고 이미 판단해 뒀고
     * ({@link DemoSeed}), 그 판단은 데이터뿐 아니라 <b>스키마에도</b> 적용돼야 한다.
     * {@code IF EXISTS}라 이미 없는 DB에서는 아무 일도 하지 않는다.
     */
    private void dropRetiredColumns() {
        entityManager
                .createNativeQuery("alter table if exists demo_users drop column if exists pin")
                .executeUpdate();
    }

    private void wipe() {
        // 분개 → 이체 → 멱등 기록 → 자동이체 → 계좌 순. 참조가 느슨해 순서가 자유롭지만
        // 읽는 사람이 "무엇이 무엇에 딸린 것인가"를 알 수 있게 이 순서로 적는다.
        ledger.deleteAllInBatch();
        transfers.deleteAllInBatch();
        idempotency.deleteAllInBatch();
        autoTransfers.deleteAllInBatch();
        accounts.deleteAllInBatch();
        users.deleteAllInBatch();
        // 판 번호 줄은 지우지 않는다 — 위에서 있는 줄을 고쳐 쓴다 (`DemoSeed.moveTo`).
    }

    private void seedUsers() {
        users.saveAll(
                personas.users().stream()
                        .map(
                                user ->
                                        new DemoUser(
                                                user.id(),
                                                user.name(),
                                                user.ageBand(),
                                                user.group()))
                        .toList());
    }

    private void seedAccounts() {
        accounts.saveAll(
                personas.accounts().stream()
                        .map(
                                account ->
                                        new Account(
                                                account.id(),
                                                account.number(),
                                                /*
                                                 * 원장에 남는 이름은 **남이 부르는 이름**이다.
                                                 * 거래내역과 받는 분 목록이 이 값을 쓴다 —
                                                 * 주인이 부르는 이름('주거래 통장')이 남의
                                                 * 이체 목록에 뜨면 그것이 누구인지 알 수 없다.
                                                 */
                                                account.nickname(),
                                                "KRW",
                                                Account.Type.ASSET,
                                                account.ownerId()))
                        .toList());
        accounts.save(
                new Account(OPENING, "000-000-000000", "개시 분개", "KRW", Account.Type.EQUITY));

        for (DemoPersonaCatalog.PersonaAccount account : personas.accounts()) {
            /*
             * 개시 잔액이 0이면 분개를 만들지 않는다. 0원짜리 이체는 원장이 거절하고
             * (그래서 전에는 0.01원을 넣었다), 받기만 하는 계좌에 주인이 생긴 뒤로는
             * 그 1전이 자기 통장 목록에 "0.01원"으로 뜬다.
             */
            if (account.opening().signum() > 0) {
                open(account.id(), account.opening(), Instant.parse("2026-07-01T00:00:00Z"));
            }
        }
    }

    private void seedHistory() {
        for (DemoPersonaCatalog.HistoryEntry row : personas.history()) {
            post(row.from(), row.to(), row.amount(), row.label(), row.instant());
        }
    }

    private void seedAutoTransfers() {
        autoTransfers.saveAll(
                personas.autoTransfers().stream()
                        .map(
                                row ->
                                        new AutoTransfer(
                                                row.id(),
                                                row.fromAccountId(),
                                                row.toAccountId(),
                                                row.payee(),
                                                row.amount(),
                                                row.dayOfMonth(),
                                                row.active()))
                        .toList());
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
