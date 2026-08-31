package com.minui.bank.repository;

import com.minui.bank.domain.DemoSeed;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DemoSeedRepository extends JpaRepository<DemoSeed, String> {}
