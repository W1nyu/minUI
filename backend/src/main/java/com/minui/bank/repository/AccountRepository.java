package com.minui.bank.repository;

import com.minui.bank.domain.Account;
import jakarta.persistence.LockModeType;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AccountRepository extends JpaRepository<Account, String> {

    /**
     * 이체에 참여하는 계좌들을 <b>ID 오름차순으로</b> 잠근다.
     *
     * <p>순서가 이 메서드의 존재 이유다. A→B 이체와 B→A 이체가 동시에 들어올 때 각자 자기
     * 출금 계좌부터 잠그면 서로가 가진 락을 기다리며 데드락이 난다. 모든 트랜잭션이 같은
     * 순서로 잠그면 그런 순환이 생기지 않는다.
     *
     * <p>{@code ORDER BY}를 쿼리 안에 두는 것이 중요하다. 조회한 뒤 자바에서 정렬하면
     * 잠그는 시점의 순서는 여전히 DB가 정하는 대로다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Account a where a.id in :ids order by a.id asc")
    List<Account> lockAllByIdInOrder(@Param("ids") List<String> ids);

    List<Account> findAllByOrderByNumberAsc();
}
