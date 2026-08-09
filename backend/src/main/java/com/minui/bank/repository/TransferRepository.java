package com.minui.bank.repository;

import com.minui.bank.domain.Transfer;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TransferRepository extends JpaRepository<Transfer, String> {

    List<Transfer> findByFromAccountIdOrderByCreatedAtDesc(String fromAccountId);
}
