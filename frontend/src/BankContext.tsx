import type { MenuId } from "@minui/core";
import { useMinUI } from "@minui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

    const primary = nextAccounts[0];
    setTransactions(primary ? await api.listTransactions(primary.id) : []);
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
