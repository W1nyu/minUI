package com.minui.bank.repository;

import com.minui.bank.domain.LedgerEntry;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface LedgerEntryRepository extends JpaRepository<LedgerEntry, String> {

    /**
     * 잔액 = 분개의 합 (기획안 §10.1).
     *
     * <p>차변은 더하고 대변은 뺀다. 계좌에 잔액 컬럼이 없으므로 이 질의가 잔액의
     * 유일한 정의다. 분개가 하나도 없으면 0을 돌려준다.
     */
    @Query("""
            select coalesce(sum(
                case when e.side = com.minui.bank.domain.LedgerEntry$Side.DEBIT
                     then e.amount else -e.amount end), 0)
            from LedgerEntry e
            where e.accountId = :accountId
            """)
    BigDecimal balanceOf(@Param("accountId") String accountId);

    List<LedgerEntry> findByAccountIdOrderByPostedAtDescIdDesc(String accountId);

    List<LedgerEntry> findByAccountIdAndPostedAtBetweenOrderByPostedAtDescIdDesc(
            String accountId, Instant from, Instant to);

    List<LedgerEntry> findByTransferId(String transferId);

    /**
     * 전 계좌의 차변 합과 대변 합. 둘이 같아야 원장 전체가 정합하다.
     *
     * <p>감사용 질의다. 잔액을 컬럼으로 들고 있었다면 이런 검사를 할 방법이 없다 —
     * 무엇과 무엇을 비교해야 하는지가 정의되지 않기 때문이다.
     */
    @Query("""
            select
                coalesce(sum(case when e.side = com.minui.bank.domain.LedgerEntry$Side.DEBIT
                                  then e.amount else 0 end), 0),
                coalesce(sum(case when e.side = com.minui.bank.domain.LedgerEntry$Side.CREDIT
                                  then e.amount else 0 end), 0)
            from LedgerEntry e
            """)
    List<Object[]> debitAndCreditTotals();
}
