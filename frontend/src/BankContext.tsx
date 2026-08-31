import type { MenuId } from "@minui/core";
import { useMinUI } from "@minui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Account,
  AutoTransfer,
  BankApi,
  Payee,
  Transaction,
  UpcomingDeposit,
} from "./api/types.js";
import { useTaskRecorder } from "./instrumentation/TaskRecorder.js";

interface BankContextValue {
  api: BankApi;
  accounts: Account[];
  /**
   * 지금 보고 있는 통장. 거래내역과 이체의 기본 출금 계좌가 이것을 따른다.
   *
   * <p>전에는 `accounts[0]`이 곧 답이었다. 사람마다 통장 수가 달라지면서 '첫 번째'가
   * 아니라 <b>고른 것</b>이어야 하는 자리가 생겼다. 아무것도 안 고르면 여전히 첫 통장이다.
   */
  selectedAccount: Account | undefined;
  selectAccount: (accountId: string) => void;
  transactions: Transaction[];
  autoTransfers: AutoTransfer[];
  payees: Payee[];
  deposits: UpcomingDeposit[];
  reload: () => Promise<void>;
  setAutoTransferActive: (id: string, active: boolean) => Promise<void>;
  /** 작업 완료 기록. 엔진의 complete를 그대로 노출한다. */
  complete: (menuId: MenuId) => void;
}

const BankContext = createContext<BankContextValue | null>(null);

export function BankProvider({ api, children }: { api: BankApi; children: ReactNode }) {
  const { complete: engineComplete } = useMinUI();
  const recorder = useTaskRecorder();

  /**
   * 작업 완료는 두 곳이 알아야 한다 — 랭킹을 매기는 엔진과, 과제 시간을 재는 계측.
   * 화면들이 두 번 부르게 하지 않고 여기서 한 번에 흘려보낸다.
   */
  const complete = useCallback(
    (menuId: MenuId) => {
      engineComplete(menuId);
      recorder.finish(menuId);
    },
    [engineComplete, recorder],
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [autoTransfers, setAutoTransfers] = useState<AutoTransfer[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [deposits, setDeposits] = useState<UpcomingDeposit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /*
   * 고른 통장을 ref로도 들고 있는다.
   *
   * <p>`reload`가 이 값을 읽어야 하는데 의존성으로 넣으면 <b>고를 때마다 전체를 다시
   * 불러온다</b> — 통장을 바꾸는 것은 거래내역만 바뀌는 일이지 계좌·수취인·자동이체를
   * 다시 받아올 일이 아니다.
   */
  const selectedIdRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const [nextAccounts, nextAuto, nextPayees, nextDeposits] = await Promise.all([
      api.listAccounts(),
      api.listAutoTransfers(),
      api.listRecentPayees(),
      api.listUpcomingDeposits(),
    ]);
    setAccounts(nextAccounts);
    setAutoTransfers(nextAuto);
    setPayees(nextPayees);
    setDeposits(nextDeposits);

    /*
     * 고른 통장이 이번 목록에 없으면 (사람이 바뀌었다) 주거래로 되돌린다.
     * 남아 있는 id로 남의 거래내역을 부르는 것이 여기서 막힌다.
     */
    const chosen =
      nextAccounts.find((account) => account.id === selectedIdRef.current) ?? nextAccounts[0];
    selectedIdRef.current = chosen?.id ?? null;
    setSelectedId(chosen?.id ?? null);
    setTransactions(chosen ? await api.listTransactions(chosen.id) : []);
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectAccount = useCallback(
    (accountId: string) => {
      selectedIdRef.current = accountId;
      setSelectedId(accountId);
      void api.listTransactions(accountId).then(setTransactions);
    },
    [api],
  );

  const setAutoTransferActive = useCallback(
    async (id: string, active: boolean) => {
      await api.setAutoTransferActive(id, active);
      setAutoTransfers(await api.listAutoTransfers());
    },
    [api],
  );

  const value = useMemo<BankContextValue>(
    () => ({
      api,
      accounts,
      selectedAccount: accounts.find((account) => account.id === selectedId) ?? accounts[0],
      selectAccount,
      transactions,
      autoTransfers,
      payees,
      deposits,
      reload,
      setAutoTransferActive,
      complete,
    }),
    [
      api,
      accounts,
      selectedId,
      selectAccount,
      transactions,
      autoTransfers,
      payees,
      deposits,
      reload,
      setAutoTransferActive,
      complete,
    ],
  );

  return <BankContext.Provider value={value}>{children}</BankContext.Provider>;
}

export function useBank(): BankContextValue {
  const value = useContext(BankContext);
  if (!value) throw new Error("useBank는 <BankProvider> 안에서만 쓸 수 있습니다.");
  return value;
}
