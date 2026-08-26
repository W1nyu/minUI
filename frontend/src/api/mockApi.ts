/**
 * 이전 경로 호환용 내보내기.
 *
 * <p>실제 구현은 `openBankingMock.ts`에 있다. 기존 테스트와 외부 예제가 같은 import를
 * 계속 쓸 수 있도록 이 파일은 남긴다.
 */
export {
  MockBankApi,
  OpenBankingMockApi,
  SessionLedgerStorage,
  SessionOpenBankingMockApi,
  type DemoLedgerSnapshot,
  type OpenBankingDepositRequest,
  type OpenBankingDepositResponse,
} from "./openBankingMock.js";
