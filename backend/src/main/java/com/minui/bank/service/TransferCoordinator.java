package com.minui.bank.service;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * 같은 멱등성 키로 <b>동시에</b> 들어온 요청을 하나로 만든다.
 *
 * <p>이 클래스가 {@link TransferService}와 분리되어 있는 이유는 스프링 트랜잭션의 동작
 * 때문이다. 같은 빈 안에서 메서드를 직접 호출하면 프록시를 거치지 않아 {@code @Transactional}이
 * 적용되지 않는다. 실패한 트랜잭션을 잡아서 <b>다른</b> 트랜잭션으로 결과를 다시 읽으려면
 * 두 호출이 각각 프록시를 지나야 하고, 그러려면 서로 다른 빈이어야 한다.
 *
 * <p>흐름은 이렇다. 두 요청이 동시에 "이 키는 처음"이라고 판단하고 나란히 진행하면,
 * 커밋 시점에 {@code idempotency_records}의 기본 키 제약이 하나를 떨어뜨린다. 진 쪽은
 * 자기 트랜잭션이 통째로 롤백되므로 원장에 아무것도 남기지 않는다. 그리고 이긴 쪽이 남긴
 * 결과를 읽어 같은 응답을 돌려준다 — 클라이언트 입장에서 두 요청은 구별되지 않아야 한다.
 *
 * <p>애플리케이션에서 "먼저 조회하고 없으면 삽입"만으로는 이 경쟁을 막을 수 없다.
 * 조회와 삽입 사이에 틈이 있기 때문이다. 최종 판정은 DB 제약이 내려야 한다.
 */
@Service
public class TransferCoordinator {

    private final TransferService transfers;

    public TransferCoordinator(TransferService transfers) {
        this.transfers = transfers;
    }

    public TransferService.Result transfer(
            String idempotencyKey, TransferService.Command command) {
        try {
            return transfers.transfer(idempotencyKey, command);
        } catch (DataIntegrityViolationException race) {
            return transfers
                    .findResultByKey(idempotencyKey)
                    .orElseThrow(() -> race);
        }
    }
}
