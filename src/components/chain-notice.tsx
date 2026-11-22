"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-http";
import {
  connectLocalChain,
  currentChainProgress,
  forgetPendingTransaction,
  pendingChainTransaction,
  resumePendingTransaction,
} from "@/lib/chain-client";
import type { ChainProgress, ChainStatus } from "@/lib/chain-types";
export function ChainNotice() {
  const path = usePathname(),
    [status, setStatus] = useState<ChainStatus | null>(null),
    [progress, setProgress] = useState<ChainProgress | null>(null),
    [pending, setPending] = useState(false),
    [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setStatus(await api<ChainStatus>("/api/chain/status"));
    } catch {
      setStatus({
        enabled: true,
        ready: false,
        error: "Unable to check the blockchain connection. Refresh and retry.",
      });
    }
  }, []);
  useEffect(() => {
    void reload();
    setProgress(currentChainProgress());
    setPending(Boolean(pendingChainTransaction()));
  }, [path, reload]);
  useEffect(() => {
    const changed = (e: Event) => {
      setProgress((e as CustomEvent<ChainProgress>).detail);
      setPending(Boolean(pendingChainTransaction()));
    };
    window.addEventListener("dapp-chain-progress", changed);
    return () => window.removeEventListener("dapp-chain-progress", changed);
  }, []);
  if (!status?.enabled) return null;
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setProgress({
        stage: "error",
        message: e instanceof Error ? e.message : "Operation failed.",
      });
    } finally {
      setBusy(false);
      setPending(Boolean(pendingChainTransaction()));
    }
  };
  return (
    <aside className="chain-notice" aria-label="Blockchain connection">
      <div>
        <strong>
          {status.ready
            ? "Local Ethereum connected"
            : "Local Ethereum unavailable"}
        </strong>
        <span className="small">
          Chain {status.chainId || 31337}{" "}
          {status.address
            ? ` · Contract ${status.address.slice(0, 8)}…${status.address.slice(-6)}`
            : ""}
        </span>
      </div>
      {!status.ready && <p role="alert">{status.error}</p>}
      {progress && (
        <p role={progress.stage === "error" ? "alert" : "status"}>
          {progress.message}{" "}
          {progress.hash && (
            <Link href={`/transactions/${progress.hash}`}>
              View transaction
            </Link>
          )}
        </p>
      )}
      <div className="button-row">
        {status.ready && (
          <button
            className="button button-secondary button-small"
            disabled={busy}
            onClick={() =>
              void act(() =>
                connectLocalChain({
                  chainId: status.chainId!,
                  rpcUrl: status.rpcUrl!,
                }),
              )
            }
          >
            Connect local network
          </button>
        )}
        <button
          className="button button-ghost button-small"
          disabled={busy}
          onClick={() => void act(reload)}
        >
          Check connection
        </button>
        {pending && (
          <>
            <button
              className="button button-small"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await resumePendingTransaction();
                  window.location.assign(`/products/${result.product_id}`);
                })
              }
            >
              Resume synchronization
            </button>
            <button
              className="button button-ghost button-small"
              disabled={busy}
              onClick={() => {
                forgetPendingTransaction();
                setPending(false);
              }}
            >
              Forget browser request
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
