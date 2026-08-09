package com.minui.bank.repository;

import com.minui.bank.domain.AutoTransfer;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AutoTransferRepository extends JpaRepository<AutoTransfer, String> {

    List<AutoTransfer> findByFromAccountIdOrderByDayOfMonthAsc(String fromAccountId);
}
