package com.minui.bank.repository;

import com.minui.bank.domain.DemoUser;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DemoUserRepository extends JpaRepository<DemoUser, String> {}
