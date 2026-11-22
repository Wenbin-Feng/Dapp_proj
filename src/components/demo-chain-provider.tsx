"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
import { api } from "@/lib/api-client";
import { demoChain, type DemoConfig } from "@/lib/chain/config";
import {
  assertWalletContext,
  transactionError,
  confirmTransaction,
  ReceiptRejectedError,
  type TransactionEntry,
} from "@/lib/chain/transactions";
import { useWallet } from "./wallet-provider";

export type ContractCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};
type Client = ReturnType<typeof createPublicClient>;
type Context = {
  walletRevision: number;
  config: DemoConfig | null;
  client: Client | null;
  loading: boolean;
  error: string | null;
  configError: string | null;
  busy: boolean;
  message: string | null;
  entries: TransactionEntry[];
  invoke: (call: ContractCall, label: string) => Promise<Hash>;
  resume: (entry: TransactionEntry) => Promise<boolean>;
};
const DemoContext = createContext<Context | null>(null);
const storageKey = "dapp-demo-transactions-v1";

function storedEntries(): TransactionEntry[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(items)) return [];
    return items
      .filter(
        (item): item is TransactionEntry =>
          item &&
          /^0x[0-9a-fA-F]{64}$/.test(item.hash) &&
          /^0x[0-9a-fA-F]{40}$/.test(item.account) &&
          [31337, 11155111].includes(item.chainId) &&
          typeof item.label === "string" &&
          typeof item.createdAt === "string" &&
          ["pending", "confirming", "confirmed", "failed"].includes(
            item.status,
          ),
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function DemoChainProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletRevision, setWalletRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [entries, setEntries] = useState<TransactionEntry[]>([]);
  const locked = useRef(false);
  const identity = useRef(wallet.address);
  identity.current = wallet.address;

  useEffect(() => {
    const changed = () => {
      setWalletRevision((value) => value + 1);
      setMessage(
        "Wallet network changed. Review the operation again. Submitted transactions are still checked on their original network.",
      );
    };
    wallet.provider?.on?.("chainChanged", changed);
    return () => wallet.provider?.removeListener?.("chainChanged", changed);
  }, [wallet.provider]);

  useEffect(() => {
    let active = true;
    void api<DemoConfig | null>("/api/chain/config")
      .then((value) => {
        if (!active) return;
        setConfig(value);
        if (value)
          setClient(
            createPublicClient({
              chain: demoChain(value),
              transport: http(value.rpcUrl),
            }),
          );
      })
      .catch((reason) => {
        if (active) {
          setError(transactionError(reason));
          setConfigError(transactionError(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    setEntries(storedEntries());
    const reload = () => setEntries(storedEntries());
    window.addEventListener("storage", reload);
    return () => {
      active = false;
      window.removeEventListener("storage", reload);
    };
  }, []);

  const record = useCallback((entry: TransactionEntry) => {
    const next = [
      entry,
      ...storedEntries().filter(
        (item) => item.hash !== entry.hash || item.chainId !== entry.chainId,
      ),
    ].slice(0, 100);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Receipt tracking still works if browser storage is full. */
    }
    setEntries(next);
  }, []);

  const confirm = useCallback(
    (entry: TransactionEntry, rpc: Client) =>
      confirmTransaction(rpc, entry, record),
    [record],
  );

  const invoke = useCallback(
    async (call: ContractCall, label: string): Promise<Hash> => {
      if (locked.current)
        throw new Error(
          "Finish the current wallet request before submitting another.",
        );
      if (!config || !client || !wallet.provider || !wallet.address)
        throw new Error(
          "Connect MetaMask and configure the demo network first.",
        );
      locked.current = true;
      setBusy(true);
      setError(null);
      let entry: TransactionEntry | undefined;
      let confirmed = false;
      const account = wallet.address as Address;
      const provider = wallet.provider as EIP1193Provider;
      try {
        await assertWalletContext(provider, account, config.chainId);
        if ((await client.getChainId()) !== config.chainId)
          throw new Error("The configured RPC is on a different network.");
        setMessage(`Checking ${label.toLowerCase()}…`);
        const { request } = await client.simulateContract({ ...call, account });
        await assertWalletContext(provider, account, config.chainId);
        if (identity.current !== account)
          throw new Error(
            "The signed-in account changed. Review the operation again.",
          );
        const signer = createWalletClient({
          account,
          chain: demoChain(config),
          transport: custom(provider),
        });
        setMessage(
          `Confirm ${label.toLowerCase()} in MetaMask. The transaction uses test ETH for gas.`,
        );
        const hash = await signer.writeContract(request);
        entry = {
          hash,
          account,
          chainId: config.chainId,
          label,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        record(entry);
        setMessage(`${label} submitted. Waiting for a successful receipt…`);
        const finalHash = await confirm(entry, client);
        confirmed = true;
        if (identity.current?.toLowerCase() !== account.toLowerCase())
          throw new Error(
            `Transaction ${finalHash} confirmed for the previous wallet. Connect that wallet and sync its records before continuing.`,
          );
        setMessage(`${label} confirmed on chain.`);
        return finalHash;
      } catch (reason) {
        const detail = transactionError(reason);
        setError(
          entry && !confirmed && !(reason instanceof ReceiptRejectedError)
            ? `${detail} A submitted transaction can still confirm; check its receipt before trying again.`
            : detail,
        );
        setMessage(null);
        throw reason;
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [client, config, wallet.provider, wallet.address, record, confirm],
  );

  const resume = useCallback(
    async (entry: TransactionEntry) => {
      if (locked.current || !client || entry.chainId !== config?.chainId)
        return false;
      locked.current = true;
      setBusy(true);
      setError(null);
      setMessage("Checking the submitted transaction receipt…");
      try {
        await confirm(entry, client);
        setMessage(`${entry.label} confirmed on chain.`);
        return true;
      } catch (reason) {
        setError(transactionError(reason));
        setMessage(null);
        return false;
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [client, config, confirm],
  );

  return (
    <DemoContext.Provider
      value={{
        walletRevision,
        config,
        client,
        loading,
        error,
        configError,
        busy,
        message,
        entries,
        invoke,
        resume,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}

export function useDemoChain() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemoChain must be inside DemoChainProvider");
  return value;
}
