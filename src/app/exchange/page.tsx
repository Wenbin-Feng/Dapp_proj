"use client";

import { useEffect, useState, type FormEvent } from "react";
import { erc20Abi, type Address } from "viem";
import { AppShell } from "@/components/app-shell";
import { ChainGate } from "@/components/demo-chain-ui";
import { useDemoChain } from "@/components/demo-chain-provider";
import { PoolFacts, useAmmPool } from "@/components/amm-pool";
import { useWallet } from "@/components/wallet-provider";
import { PageTitle, ErrorNotice } from "@/components/ui";
import {
  routerAbi,
  amountOut,
  priceImpactBps,
  displayBps,
} from "@/lib/chain/amm";
import { tokenAddress, type DemoSymbol } from "@/lib/chain/config";
import {
  parseAmount,
  displayAmount,
  minimumAmount,
  DEADLINE_SECONDS,
} from "@/lib/chain/amounts";
import { transactionError } from "@/lib/chain/transactions";

type Quote = {
  input: bigint;
  output: bigint;
  minimum: bigint;
  allowance: bigint;
  deadline: bigint;
  impact: bigint;
};
export default function ExchangePage() {
  const { address } = useWallet();
  return (
    <AppShell>
      <PageTitle
        title="Exchange demo tokens"
        description="Swap PDC and PDQ at the pool's current exchange rate."
      />
      <ChainGate>
        <Exchange key={address} />
      </ChainGate>
    </AppShell>
  );
}

function Exchange() {
  const { config, client, busy, invoke, walletRevision } = useDemoChain();
  const { address } = useWallet();
  const { pool, error: poolError, refresh } = useAmmPool();
  const [symbol, setSymbol] = useState<DemoSymbol>("PDC");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const other: DemoSymbol = symbol === "PDC" ? "PDQ" : "PDC";
  useEffect(() => setQuote(null), [symbol, amount, address, walletRevision]);
  async function review(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setQuote(null);
    setReviewing(true);
    try {
      if (!config?.router || !client || !address)
        throw new Error("The AMM router is not configured.");
      const input = parseAmount(amount);
      const next = await refresh();
      const token = tokenAddress(config, symbol);
      const [balance, allowance, amounts] = await Promise.all([
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as Address],
          blockNumber: next.blockNumber,
        }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address as Address, config.router],
          blockNumber: next.blockNumber,
        }),
        client.readContract({
          address: config.router,
          abi: routerAbi,
          functionName: "getAmountsOut",
          args: [input, [token, tokenAddress(config, other)]],
          blockNumber: next.blockNumber,
        }),
      ]);
      if (input > balance)
        throw new Error(`Your ${symbol} balance is too low.`);
      const [reserveIn, reserveOut] =
        symbol === "PDC"
          ? [next.reservePdc, next.reservePdq]
          : [next.reservePdq, next.reservePdc];
      const output = amountOut(input, reserveIn, reserveOut);
      if (amounts[1] !== output)
        throw new Error("Router quote differs from the pool's reserves.");
      const minimum = minimumAmount(output);
      if (!minimum)
        throw new Error(
          "Liquidity or the input amount is too low to produce a protected swap.",
        );
      setQuote({
        input,
        output,
        minimum,
        allowance,
        deadline: next.timestamp + DEADLINE_SECONDS,
        impact: priceImpactBps(input, output, reserveIn, reserveOut),
      });
    } catch (reason) {
      setError(transactionError(reason));
    } finally {
      setReviewing(false);
    }
  }
  async function approve() {
    if (!quote || !config?.router) return;
    try {
      await invoke(
        {
          address: tokenAddress(config, symbol),
          abi: erc20Abi,
          functionName: "approve",
          args: [config.router, quote.input],
        },
        `Approve ${symbol} for exchange`,
      );
      await review();
    } catch (reason) {
      setError(transactionError(reason));
    }
  }
  async function swap() {
    if (!quote || !config?.router || !address) return;
    try {
      await invoke(
        {
          address: config.router,
          abi: routerAbi,
          functionName: "swapExactTokensForTokens",
          args: [
            quote.input,
            quote.minimum,
            [tokenAddress(config, symbol), tokenAddress(config, other)],
            address as Address,
            quote.deadline,
          ],
        },
        `Exchange ${symbol} for ${other}`,
      );
      setQuote(null);
      setAmount("");
      await refresh();
    } catch (reason) {
      setQuote(null);
      setError(transactionError(reason));
    }
  }
  const disabled = busy || reviewing;
  return (
    <div className="demo-stack">
      <ErrorNotice error={error || poolError} />
      <PoolFacts pool={pool} />
      <form className="panel form-panel" onSubmit={review}>
        <h2>Swap tokens</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="swap-token">Sell</label>
            <select
              id="swap-token"
              disabled={disabled}
              value={symbol}
              onChange={(event) => setSymbol(event.target.value as DemoSymbol)}
            >
              <option>PDC</option>
              <option>PDQ</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="swap-amount">Amount to sell</label>
            <input
              id="swap-amount"
              inputMode="decimal"
              placeholder="0.00"
              required
              disabled={disabled}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </div>
        <p>Receive {other}. Rates change with the pool's reserves.</p>
        <button
          className="button button-secondary"
          disabled={disabled || !pool}
        >
          Review exchange
        </button>
      </form>
      {quote && (
        <section className="panel demo-stack" aria-label="Exchange quote">
          <h2>Review before signing</h2>
          <dl className="facts-grid">
            <div>
              <dt>Estimated {other}</dt>
              <dd>{displayAmount(quote.output)}</dd>
            </div>
            <div>
              <dt>Minimum {other} received</dt>
              <dd>{displayAmount(quote.minimum)}</dd>
            </div>
            <div>
              <dt>Price impact (excluding fee)</dt>
              <dd>{displayBps(quote.impact)}</dd>
            </div>
            <div>
              <dt>Valid until</dt>
              <dd>
                {new Date(Number(quote.deadline) * 1000).toLocaleTimeString()}
              </dd>
            </div>
          </dl>
          <p className="small muted">
            1% slippage tolerance · 10-minute deadline · 0.3% trading fee.
            Slippage tolerance does not limit the trade's price impact.
          </p>
          {quote.impact > 500n && (
            <div className="notice" role="alert">
              High price impact: this trade is large relative to available
              liquidity. Consider a smaller amount.
            </div>
          )}
          <p className="mono small">Spender: {config?.router}</p>
          {quote.allowance < quote.input ? (
            <button
              className="button"
              disabled={disabled}
              onClick={() => void approve()}
            >
              Approve {displayAmount(quote.input)} {symbol}
            </button>
          ) : (
            <button
              className="button"
              disabled={disabled}
              onClick={() => void swap()}
            >
              Confirm exchange
            </button>
          )}
          <p className="small muted">
            Approval never submits the exchange. After approval the quote is
            refreshed for you to review again.
          </p>
        </section>
      )}
      <p className="small muted">
        Pool prices can be manipulated and are not a product valuation or a
        real-currency exchange rate.
      </p>
    </div>
  );
}
