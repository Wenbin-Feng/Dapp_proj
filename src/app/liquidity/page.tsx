"use client";

import { useEffect, useState, type FormEvent } from "react";
import { erc20Abi, type Address } from "viem";
import { AppShell } from "@/components/app-shell";
import { ChainGate } from "@/components/demo-chain-ui";
import { useDemoChain } from "@/components/demo-chain-provider";
import { PoolFacts, useAmmPool } from "@/components/amm-pool";
import { useWallet } from "@/components/wallet-provider";
import { PageTitle, ErrorNotice } from "@/components/ui";
import { routerAbi } from "@/lib/chain/amm";
import {
  parseAmount,
  displayAmount,
  minimumAmount,
  DEADLINE_SECONDS,
} from "@/lib/chain/amounts";
import { transactionError } from "@/lib/chain/transactions";

type Quote = {
  a: bigint;
  b: bigint;
  lp: bigint;
  minA: bigint;
  minB: bigint;
  deadline: bigint;
  approvals: {
    token: Address;
    symbol: string;
    amount: bigint;
    allowance: bigint;
  }[];
};
export default function LiquidityPage() {
  const { address } = useWallet();
  return (
    <AppShell>
      <PageTitle
        title="Pool liquidity"
        description="Deposit both demo currencies to receive LP tokens, or redeem your LP share."
      />
      <ChainGate>
        <Liquidity key={address} />
      </ChainGate>
    </AppShell>
  );
}

function Liquidity() {
  const { config, client, busy, invoke, walletRevision } = useDemoChain();
  const { address } = useWallet();
  const { pool, error: poolError, refresh } = useAmmPool();
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("25");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useEffect(
    () => setQuote(null),
    [mode, amount, percent, address, walletRevision],
  );
  async function review(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setQuote(null);
    setReviewing(true);
    try {
      if (!config?.pair || !config.router || !client || !address)
        throw new Error("The pool is not configured.");
      const next = await refresh();
      let a: bigint, b: bigint, lp: bigint;
      if (mode === "add") {
        a = parseAmount(amount);
        b = (a * next.reservePdq) / next.reservePdc;
        const lpA = (a * next.totalSupply) / next.reservePdc;
        const lpB = (b * next.totalSupply) / next.reservePdq;
        lp = lpA < lpB ? lpA : lpB;
      } else {
        if (
          !/^\d{1,3}$/.test(percent) ||
          BigInt(percent) < 1n ||
          BigInt(percent) > 100n
        )
          throw new Error("Choose a withdrawal percentage between 1 and 100.");
        lp = (next.lpBalance * BigInt(percent)) / 100n;
        a = (lp * next.reservePdc) / next.totalSupply;
        b = (lp * next.reservePdq) / next.totalSupply;
      }
      if (!lp || !minimumAmount(a) || !minimumAmount(b))
        throw new Error(
          "The amount is too small after integer rounding. Choose a larger amount.",
        );
      const needed =
        mode === "add"
          ? [
              { token: config.pdc, symbol: "PDC", amount: a },
              { token: config.pdq, symbol: "PDQ", amount: b },
            ]
          : [{ token: config.pair, symbol: "LP", amount: lp }];
      const approvals = await Promise.all(
        needed.map(async (item) => {
          const [balance, allowance] = await Promise.all([
            client.readContract({
              address: item.token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address as Address],
              blockNumber: next.blockNumber,
            }),
            client.readContract({
              address: item.token,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address as Address, config.router!],
              blockNumber: next.blockNumber,
            }),
          ]);
          if (balance < item.amount)
            throw new Error(`Your ${item.symbol} balance is too low.`);
          return { ...item, allowance };
        }),
      );
      setQuote({
        a,
        b,
        lp,
        minA: minimumAmount(a),
        minB: minimumAmount(b),
        deadline: next.timestamp + DEADLINE_SECONDS,
        approvals,
      });
    } catch (reason) {
      setError(transactionError(reason));
    } finally {
      setReviewing(false);
    }
  }
  async function approve(item: Quote["approvals"][number]) {
    if (!config?.router) return;
    try {
      await invoke(
        {
          address: item.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [config.router, item.amount],
        },
        `Approve ${item.symbol} for liquidity`,
      );
      await review();
    } catch (reason) {
      setError(transactionError(reason));
    }
  }
  async function confirm() {
    if (!quote || !config?.router || !address) return;
    try {
      await invoke(
        {
          address: config.router,
          abi: routerAbi,
          functionName: mode === "add" ? "addLiquidity" : "removeLiquidity",
          args:
            mode === "add"
              ? [
                  config.pdc,
                  config.pdq,
                  quote.a,
                  quote.b,
                  quote.minA,
                  quote.minB,
                  address as Address,
                  quote.deadline,
                ]
              : [
                  config.pdc,
                  config.pdq,
                  quote.lp,
                  quote.minA,
                  quote.minB,
                  address as Address,
                  quote.deadline,
                ],
        },
        mode === "add" ? "Add liquidity" : "Remove liquidity",
      );
      setQuote(null);
      await refresh();
    } catch (reason) {
      setQuote(null);
      setError(transactionError(reason));
    }
  }
  const disabled = busy || reviewing;
  const approval = quote?.approvals.find(
    (item) => item.allowance < item.amount,
  );
  return (
    <div className="demo-stack">
      <ErrorNotice error={error || poolError} />
      <PoolFacts pool={pool} />
      {pool && config?.pair && config.router && (
        <div className="panel">
          <h2>LP allowance</h2>
          <p>
            {displayAmount(pool.lpAllowance)} LP approved to the AMM router.
          </p>
          <p className="mono small">{config.router}</p>
          <button
            className="button button-secondary"
            disabled={busy || pool.lpAllowance === 0n}
            onClick={() =>
              void invoke(
                {
                  address: config.pair!,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [config.router!, 0n],
                },
                "Revoke LP allowance",
              )
                .then(refresh)
                .catch((reason) => setError(transactionError(reason)))
            }
          >
            Revoke LP allowance
          </button>
        </div>
      )}
      <form className="panel form-panel" onSubmit={review}>
        <h2>Manage your LP share</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="liquidity-action">Action</label>
            <select
              id="liquidity-action"
              disabled={disabled}
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as "add" | "remove")
              }
            >
              <option value="add">Add liquidity</option>
              <option value="remove">Remove liquidity</option>
            </select>
          </div>
          {mode === "add" ? (
            <div className="field">
              <label htmlFor="liquidity-pdc">PDC amount</label>
              <input
                id="liquidity-pdc"
                required
                disabled={disabled}
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          ) : (
            <div className="field">
              <label htmlFor="liquidity-percent">LP percentage to remove</label>
              <input
                id="liquidity-percent"
                required
                disabled={disabled}
                type="number"
                min="1"
                max="100"
                step="1"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
              />
            </div>
          )}
        </div>
        <button
          className="button button-secondary"
          disabled={disabled || !pool}
        >
          Review liquidity
        </button>
      </form>
      {quote && (
        <section className="panel demo-stack" aria-label="Liquidity quote">
          <h2>
            {mode === "add"
              ? "Deposit at the current pool ratio"
              : "Withdraw the current asset mix"}
          </h2>
          <dl className="facts-grid">
            <div>
              <dt>
                {mode === "add" ? "PDC deposit" : "Estimated PDC returned"}
              </dt>
              <dd>{displayAmount(quote.a)}</dd>
            </div>
            <div>
              <dt>
                {mode === "add" ? "PDQ deposit" : "Estimated PDQ returned"}
              </dt>
              <dd>{displayAmount(quote.b)}</dd>
            </div>
            <div>
              <dt>
                {mode === "add" ? "Estimated LP received" : "LP redeemed"}
              </dt>
              <dd>{displayAmount(quote.lp)}</dd>
            </div>
            <div>
              <dt>Minimum PDC / PDQ</dt>
              <dd>
                {displayAmount(quote.minA)} / {displayAmount(quote.minB)}
              </dd>
            </div>
          </dl>
          <p className="small muted">
            1% minimum-amount protection · valid until{" "}
            {new Date(Number(quote.deadline) * 1000).toLocaleTimeString()}.
            Quotes refresh after each approval.
          </p>
          <p className="mono small">Spender: {config?.router}</p>
          {approval ? (
            <button
              className="button"
              disabled={disabled}
              onClick={() => void approve(approval)}
            >
              Approve {displayAmount(approval.amount)} {approval.symbol}
            </button>
          ) : (
            <button
              className="button"
              disabled={disabled}
              onClick={() => void confirm()}
            >
              Confirm {mode === "add" ? "deposit" : "withdrawal"}
            </button>
          )}
        </section>
      )}
      <section className="panel">
        <h2>Understand the LP share</h2>
        <p>
          Withdrawals return the pool's current asset mix, which can differ from
          your original deposit. Price changes can cause impermanent loss;
          trading fees do not guarantee that it is covered. Fees accrue inside
          the pool rather than being sent automatically to your wallet.
        </p>
        <p className="small muted">
          The first 1,000 base units of LP supply are permanently locked by V2.
          Rounding can leave small residual balances.
        </p>
      </section>
    </div>
  );
}
