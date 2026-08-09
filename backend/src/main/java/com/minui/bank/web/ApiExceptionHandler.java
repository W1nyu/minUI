package com.minui.bank.web;

import com.minui.bank.service.TransferService;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 오류 응답.
 *
 * <p>메시지는 사용자에게 그대로 보일 수 있는 말로 쓴다 — "잔액이 부족합니다"는 무엇이
 * 잘못됐고 무엇을 하면 되는지 알려 주지만, "INSUFFICIENT_FUNDS"는 그렇지 않다.
 * 프런트가 코드를 다시 한국어로 번역하는 층을 만들 이유가 없다.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    public record ErrorResponse(String message) {}

    @ExceptionHandler(TransferService.TransferFailed.class)
    public ResponseEntity<ErrorResponse> onTransferFailed(TransferService.TransferFailed e) {
        return ResponseEntity.unprocessableEntity().body(new ErrorResponse(e.getMessage()));
    }

    /**
     * 같은 멱등성 키로 다른 내용의 요청이 온 경우. 409를 돌려주는 이유는
     * 이것이 재시도가 아니라 클라이언트 버그이기 때문이다 — 조용히 옛 결과를
     * 돌려주면 그 버그가 영영 드러나지 않는다.
     */
    @ExceptionHandler(TransferService.IdempotencyConflict.class)
    public ResponseEntity<ErrorResponse> onConflict(TransferService.IdempotencyConflict e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse(e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> onInvalid(MethodArgumentNotValidException e) {
        String message =
                e.getBindingResult().getFieldErrors().stream()
                        .map(error -> Map.of(error.getField(), error.getDefaultMessage()))
                        .findFirst()
                        .map(Object::toString)
                        .orElse("요청 내용을 확인해 주세요.");
        return ResponseEntity.badRequest().body(new ErrorResponse(message));
    }
}
