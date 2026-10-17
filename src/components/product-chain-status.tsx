"use client";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useDemoChain } from "./demo-chain-provider";
import { useWallet } from "./wallet-provider";
import { ChainNotice } from "./demo-chain-ui";
import { ErrorNotice } from "./ui";
import { chainRoles } from "@/lib/chain/config";
import { productAbi } from "@/lib/chain/product-abi";
import { api } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/types";
import type { SyncResult } from "@/lib/chain/product-indexer";
import { transactionError } from "@/lib/chain/transactions";

export function ProductChainStatus() {
  const chain = useDemoChain();
  const wallet = useWallet();
  const [role, setRole] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState("");
  const read = useCallback(async () => {
    if (!chain.client || !chain.config?.products || !wallet.address) return;
    setRole(
      await chain.client.readContract({
        address: chain.config.products,
        abi: productAbi,
        functionName: "roles",
        args: [wallet.address as Address],
      }),
    );
  }, [chain.client, chain.config, wallet.address]);
  useEffect(() => {
    if (chain.config?.productBackend === "chain")
      void read().catch((reason) => setError(transactionError(reason)));
  }, [chain.config?.productBackend, read]);
  if (chain.config?.productBackend !== "chain" || !wallet.profile) return null;
  const expected = chainRoles[wallet.profile.role];
  async function sync() {
    setSyncing(true);
    setError(null);
    setStatus("");
    try {
      const result = await api<SyncResult>("/api/chain/sync", {
        method: "POST",
        body: "{}",
      });
      setStatus(
        result.backlog
          ? "Confirmed events are still catching up. Sync again to continue."
          : "Confirmed events are synchronized. Reload this page to refresh your products.",
      );
    } catch (reason) {
      setError(transactionError(reason));
    } finally {
      setSyncing(false);
    }
  }
  return (
    <div className="demo-stack" style={{ marginBottom: 24 }}>
      <ChainNotice />
      <ErrorNotice error={error} />
      <div className="panel demo-row">
        <div>
          <strong>Products use test-network transactions</strong>
          <p className="small">
            {role === 0
              ? `Activate your ${ROLE_LABELS[wallet.profile.role]} role once to use product actions.`
              : role === expected
                ? `${ROLE_LABELS[wallet.profile.role]} role active. Product records follow verified chain events.`
                : role === null
                  ? "Checking your chain role…"
                  : "Your chain role differs from your website profile. Use the matching wallet or contact the team."}
          </p>
          {status && <p role="status">{status}</p>}
        </div>
        <div className="button-row">
          {role === 0 && (
            <button
              className="button button-small"
              disabled={
                chain.busy || !chain.client || !wallet.provider || !wallet.address
              }
              onClick={() =>
                void chain
                  .invoke(
                    {
                      address: chain.config!.products!,
                      abi: productAbi,
                      functionName: "enroll",
                      args: [expected],
                    },
                    `Activate ${ROLE_LABELS[wallet.profile!.role]} role`,
                  )
                  .then(read)
                  .catch((reason) => setError(transactionError(reason)))
              }
            >
              Activate {ROLE_LABELS[wallet.profile.role]}
            </button>
          )}
          <button
            className="button button-secondary button-small"
            disabled={chain.busy || syncing}
            onClick={() => void sync()}
          >
            {syncing ? "Syncing…" : "Sync products"}
          </button>
        </div>
      </div>
    </div>
  );
}
