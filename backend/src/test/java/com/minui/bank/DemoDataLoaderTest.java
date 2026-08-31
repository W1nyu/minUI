package com.minui.bank;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.minui.bank.config.DemoDataLoader;
import com.minui.bank.config.DemoPersonaCatalog;
import com.minui.bank.repository.AccountRepository;
import com.minui.bank.repository.AutoTransferRepository;
import com.minui.bank.repository.DemoSeedRepository;
import com.minui.bank.repository.DemoUserRepository;
import com.minui.bank.repository.LedgerEntryRepository;
import com.minui.bank.repository.TransferRepository;
import java.math.BigDecimal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/**
 * 시드가 실제로 깔리는가, 그리고 <b>두 번 돌아도 되는가</b>.
 *
 * <p>이 테스트가 있는 이유가 있다. {@link DemoDataLoader}는 {@code @Profile("!test")}라
 * 어떤 테스트도 그것을 돌리지 않았고, 그래서 판을 올렸을 때 죽는 버그가 통합 테스트
 * 21개를 모두 통과한 채로 <b>개발자가 서버를 띄우는 순간에만</b> 터졌다.
 * ({@code expected row count 1 but was 0} — 대량 삭제가 영속성 컨텍스트를 건너뛴 탓.)
 *
 * <p>그래서 여기서는 로더를 <b>직접 불러</b> 두 번 돌린다. 프로필 뒤에 숨은 코드는
 * 프로필 밖에서 부르면 된다.
 */
@Import({TestcontainersConfiguration.class, DemoDataLoaderTest.LoaderUnderTest.class})
@SpringBootTest
@ActiveProfiles("test")
class DemoDataLoaderTest {

    /**
     * 로더를 <b>빈으로</b> 되살린다.
     *
     * <p>직접 {@code new} 하면 안 된다 — {@code run()}의 {@code @Transactional}은 스프링
     * 프록시를 지나야 걸리고, <b>터졌던 버그가 바로 그 트랜잭션 경계의 문제였다.</b>
     * 손으로 만든 인스턴스는 그 버그를 재현하지 못한다.
     */
    @TestConfiguration
    static class LoaderUnderTest {
        @Bean
        DemoDataLoader demoDataLoaderUnderTest(
                DemoPersonaCatalog personas,
                AccountRepository accounts,
                LedgerEntryRepository ledger,
                TransferRepository transfers,
                AutoTransferRepository autoTransfers,
                com.minui.bank.repository.IdempotencyRecordRepository idempotency,
                DemoUserRepository users,
                DemoSeedRepository seeds) {
            return new DemoDataLoader(
                    personas, accounts, ledger, transfers, autoTransfers, idempotency, users, seeds);
        }
    }

    @Autowired DemoDataLoader loader;
    @Autowired DemoPersonaCatalog personas;
    @Autowired AccountRepository accounts;
    @Autowired DemoUserRepository users;
    @Autowired DemoSeedRepository seeds;
    @Autowired LedgerEntryRepository ledger;
    @Autowired TransferRepository transfers;
    @Autowired AutoTransferRepository autoTransfers;

    @BeforeEach
    void reset() {
        ledger.deleteAll();
        transfers.deleteAll();
        autoTransfers.deleteAll();
        accounts.deleteAll();
        users.deleteAll();
        seeds.deleteAll();
    }

    @Test
    @DisplayName("빈 DB에 사람과 계좌가 깔린다")
    void seedsAnEmptyDatabase() {
        loader.run();

        assertThat(users.count()).isEqualTo(personas.users().size());
        // 표의 계좌 + 개시 분개 한 개.
        assertThat(accounts.count()).isEqualTo(personas.accounts().size() + 1);
        assertThat(accounts.findById("acc-1")).isPresent();
        assertThat(accounts.findById("acc-opening")).isPresent();
        assertThat(seeds.findById("demo")).isPresent();
    }

    @Test
    @DisplayName("같은 판을 다시 돌리면 아무것도 안 한다")
    void runningTwiceWithTheSameVersionIsANoOp() {
        loader.run();
        long accountsAfterFirst = accounts.count();
        long entriesAfterFirst = ledger.count();

        loader.run();

        assertThat(accounts.count()).isEqualTo(accountsAfterFirst);
        assertThat(ledger.count()).isEqualTo(entriesAfterFirst);
    }

    /**
     * 판이 올라간 상황을 흉내 낸다 — 저장된 번호를 낮춰 두고 다시 돌린다.
     *
     * <p><b>이것이 실제로 터졌던 자리다.</b> 다시 까는 경로가 커밋에서 죽었고,
     * 그 결과 서버가 아예 안 떴다.
     */
    @Test
    @DisplayName("판이 올라가면 지우고 다시 깔되, 죽지 않는다")
    void reseedsWhenTheVersionMovesForward() {
        loader.run();
        seeds.findById("demo").orElseThrow().moveTo(1);
        seeds.flush();

        assertThatCode(loader::run).doesNotThrowAnyException();

        assertThat(users.count()).isEqualTo(personas.users().size());
        assertThat(accounts.findById("acc-1")).isPresent();
        // 다시 깐 뒤에도 판 번호가 표를 따라간다.
        assertThat(seeds.findById("demo").orElseThrow().getVersion()).isGreaterThan(1);
    }

    @Test
    @DisplayName("개시 잔액이 0인 계좌는 분개를 만들지 않는다")
    void zeroOpeningMakesNoEntry() {
        loader.run();

        // acc-5는 받기만 하는 통장이라 개시 잔액이 없다. 예전에는 1전을 넣었다.
        assertThat(ledger.balanceOf("acc-5")).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(ledger.balanceOf("acc-1")).isGreaterThan(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("원장 전체의 차·대변이 맞는다")
    void seededLedgerIsBalanced() {
        loader.run();

        BigDecimal everyAccount =
                accounts.findAll().stream()
                        .map(account -> ledger.balanceOf(account.getId()))
                        .reduce(BigDecimal.ZERO, BigDecimal::add);

        assertThat(everyAccount).isEqualByComparingTo(BigDecimal.ZERO);
    }
}
