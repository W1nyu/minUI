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
  const { complete } = useMinUI();
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
