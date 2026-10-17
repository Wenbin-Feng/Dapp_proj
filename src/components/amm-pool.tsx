"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useDemoChain } from "./demo-chain-provider";
import { useWallet } from "./wallet-provider";
import { readPool, displayBps, type Pool } from "@/lib/chain/amm";
import { displayAmount } from "@/lib/chain/amounts";
import { transactionError } from "@/lib/chain/transactions";

export function useAmmPool() {
  const { config, client } = useDemoChain();
  const { address } = useWallet();
  const [pool, setPool] = useState<Pool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!client || !config || !address)
      throw new Error("Connect a wallet first.");
    const next = await readPool(client, config, address as Address);
    setPool(next);
    setError(null);
    return next;
  }, [client, config, address]);
  useEffect(() => {
    let active = true;
    setPool(null);
    void refresh().catch((reason) => {
      if (active) setError(transactionError(reason));
    });
    return () => {
      active = false;
    };
  }, [refresh]);
  return { pool, error, refresh };
}

export function PoolFacts({ pool }: { pool: Pool | null }) {
  if (!pool) return null;
  return (
    <div className="panel">
      <h2>PDC / PDQ pool</h2>
      <dl className="facts-grid">
        <div>
          <dt>PDC reserve</dt>
          <dd>{displayAmount(pool.reservePdc)}</dd>
        </div>
        <div>
          <dt>PDQ reserve</dt>
          <dd>{displayAmount(pool.reservePdq)}</dd>
        </div>
        <div>
          <dt>Your LP tokens</dt>
          <dd>{displayAmount(pool.lpBalance)}</dd>
        </div>
        <div>
          <dt>Your pool share</dt>
          <dd>{displayBps((pool.lpBalance * 10000n) / pool.totalSupply)}</dd>
        </div>
      </dl>
      <p className="small muted">
        0.3% swap fee remains in the pool. Protocol fee is off. Other liquidity
        providers can withdraw their own shares.
      </p>
    </div>
  );
}
