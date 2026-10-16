"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  erc20Abi,
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { AppShell } from "@/components/app-shell";
import { useWallet } from "@/components/wallet-provider";
import { useDemoChain } from "@/components/demo-chain-provider";
import { ChainGate, TransactionLink } from "@/components/demo-chain-ui";
import { ErrorNotice, PageTitle } from "@/components/ui";
import { parseAmount, displayAmount } from "@/lib/chain/amounts";
import { tokenAddress, type DemoSymbol } from "@/lib/chain/config";
import { transactionError } from "@/lib/chain/transactions";

export default function WalletPage() {
  return (
    <AppShell>
      <PageTitle
        title="Demo wallet"
        description="Hold and transfer the project's fixed-supply test currencies."
      />
      <ChainGate>
        <WalletContents />
      </ChainGate>
    </AppShell>
  );
}

function WalletContents() {
  const { config, client, busy, invoke, entries, resume } = useDemoChain();
  const { address } = useWallet();
  const [balances, setBalances] = useState<{
    pdc: bigint;
    pdq: bigint;
    eth: bigint;
  } | null>(null);
  const [allowances, setAllowances] = useState<
    { symbol: DemoSymbol; spender: Address; label: string; value: bigint }[]
  >([]);
  const [symbol, setSymbol] = useState<DemoSymbol>("PDC");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<
    { hash: Hash; label: string; block: bigint; index: number }[]
  >([]);
  const [historyStart, setHistoryStart] = useState<bigint | null>(null);
  const refresh = useCallback(async () => {
    if (!config || !client || !address) return;
    const owner = address as Address;
    const [pdc, pdq, eth] = await Promise.all([
      client.readContract({
        address: config.pdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: config.pdq,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.getBalance({ address: owner }),
    ]);
    const spenders = [
      { address: config.router, label: "AMM router" },
      { address: config.products, label: "Product contract" },
    ].filter(
      (item): item is { address: Address; label: string } => !!item.address,
    );
    const approvals = await Promise.all(
      spenders.flatMap((spender) =>
        (["PDC", "PDQ"] as const).map(async (unit) => ({
          symbol: unit,
          spender: spender.address,
          label: spender.label,
          value: await client.readContract({
            address: tokenAddress(config, unit),
            abi: erc20Abi,
            functionName: "allowance",
            args: [owner, spender.address],
          }),
        })),
      ),
    );
    setBalances({ pdc, pdq, eth });
    setAllowances(approvals);
  }, [config, client, address]);

  const history = useCallback(
    async (before?: bigint) => {
      if (!config || !client || !address) return;
      const end = before ?? (await client.getBlockNumber());
      const floor = BigInt(config.fromBlock);
      if (end < floor) return;
      const start = end - floor > 1999n ? end - 1999n : floor;
      const logs = await Promise.all(
        (["PDC", "PDQ"] as const).flatMap((unit) =>
          (["from", "to"] as const).map(async (direction) => {
            const items = await client.getContractEvents({
              address: tokenAddress(config, unit),
              abi: erc20Abi,
              eventName: "Transfer",
              args: { [direction]: address as Address },
              fromBlock: start,
              toBlock: end,
              strict: true,
            });
            return items.map((item) => ({
              hash: item.transactionHash,
              index: item.logIndex,
              block: item.blockNumber,
              label: `${item.args.from?.toLowerCase() === address.toLowerCase() ? "Sent" : "Received"} ${displayAmount(item.args.value)} ${unit}`,
            }));
          }),
        ),
      );
      setTransfers((previous) =>
        [
          ...new Map(
            [...(before ? previous : []), ...logs.flat()].map((item) => [
              `${item.hash}:${item.index}`,
              item,
            ]),
          ).values(),
        ].sort((a, b) =>
          a.block > b.block ? -1 : a.block < b.block ? 1 : b.index - a.index,
        ),
      );
      setHistoryStart(start > floor ? start - 1n : null);
    },
    [config, client, address],
  );

  useEffect(() => {
    setBalances(null);
    setTransfers([]);
    void Promise.all([refresh(), history()]).catch((reason) =>
      setError(transactionError(reason)),
    );
  }, [refresh, history]);
  if (!config || !client || !address) return null;
  const mine = entries.filter(
    (entry) =>
      entry.chainId === config.chainId &&
      entry.account.toLowerCase() === address.toLowerCase(),
  );

  async function transfer(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (
        !isAddress(recipient, { strict: false }) ||
        recipient.toLowerCase() === zeroAddress
      )
        throw new Error("Enter a nonzero Ethereum recipient address.");
      const value = parseAmount(amount);
      if (!balances || value > (symbol === "PDC" ? balances.pdc : balances.pdq))
        throw new Error("The token balance is too low.");
      await invoke(
        {
          address: tokenAddress(config!, symbol),
          abi: erc20Abi,
          functionName: "transfer",
          args: [getAddress(recipient), value],
        },
        `Transfer ${symbol}`,
      );
      setAmount("");
      await Promise.all([refresh(), history()]);
    } catch (reason) {
      setError(transactionError(reason));
    }
  }
  return (
    <div className="demo-stack">
      <ErrorNotice error={error} />
      <div className="panel">
        <div className="section-title">
          <h2>Your balances</h2>
          <button
            className="button button-secondary button-small"
            disabled={busy}
            onClick={() =>
              void Promise.all([refresh(), history()]).catch((reason) =>
                setError(transactionError(reason)),
              )
            }
          >
            Refresh
          </button>
        </div>
        <dl className="facts-grid">
          <div>
            <dt>PDC</dt>
            <dd>{balances ? displayAmount(balances.pdc) : "Loading…"}</dd>
          </div>
          <div>
            <dt>PDQ</dt>
            <dd>{balances ? displayAmount(balances.pdq) : "Loading…"}</dd>
          </div>
          <div>
            <dt>Test ETH for gas</dt>
            <dd>{balances ? displayAmount(balances.eth) : "Loading…"}</dd>
          </div>
        </dl>
        <p className="small muted">
          Each currency has 1,000,000 tokens and 18 decimals. Ask the team for
          demo tokens and test ETH.
        </p>
      </div>
      <form className="panel form-panel" onSubmit={transfer}>
        <h2>Send tokens</h2>
        <p>
          Transfers go directly to the recipient and do not need an allowance.
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="send-token">Token</label>
            <select
              id="send-token"
              value={symbol}
              disabled={busy}
              onChange={(event) => setSymbol(event.target.value as DemoSymbol)}
            >
              <option>PDC</option>
              <option>PDQ</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="send-amount">Amount</label>
            <input
              id="send-amount"
              inputMode="decimal"
              value={amount}
              disabled={busy}
              required
              placeholder="0.00"
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="field full-width">
            <label htmlFor="send-recipient">Recipient address</label>
            <input
              id="send-recipient"
              value={recipient}
              disabled={busy}
              required
              placeholder="0x…"
              onChange={(event) => setRecipient(event.target.value)}
            />
          </div>
        </div>
        <button className="button" disabled={busy || !balances}>
          Send {symbol}
        </button>
      </form>
      <section className="panel">
        <h2>Contract allowances</h2>
        <p className="small muted">
          Approvals can remain after another transaction fails. Review the
          spender address before approving.
        </p>
        {allowances.length ? (
          <div className="demo-stack">
            {allowances.map((item) => (
              <div className="demo-row" key={`${item.symbol}-${item.spender}`}>
                <div>
                  <strong>
                    {item.label} · {displayAmount(item.value)} {item.symbol}
                  </strong>
                  <p className="mono small">{item.spender}</p>
                </div>
                <button
                  className="button button-secondary button-small"
                  disabled={busy || item.value === 0n}
                  onClick={() =>
                    void invoke(
                      {
                        address: tokenAddress(config, item.symbol),
                        abi: erc20Abi,
                        functionName: "approve",
                        args: [item.spender, 0n],
                      },
                      `Revoke ${item.symbol} allowance`,
                    )
                      .then(refresh)
                      .catch((reason) => setError(transactionError(reason)))
                  }
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p>No contract spenders have been deployed yet.</p>
        )}
      </section>
      <section className="panel">
        <h2>Transactions from this browser</h2>
        <p className="small muted">
          A submitted hash is pending until its receipt succeeds. History is
          kept per wallet in this browser.
        </p>
        <div className="demo-stack">
          {mine.length ? (
            mine.map((entry) => (
              <div className="demo-row" key={entry.hash}>
                <div>
                  <strong>
                    {entry.label} · {entry.status}
                  </strong>
                  <p>
                    <TransactionLink hash={entry.hash} />
                  </p>
                </div>
                {["pending", "confirming"].includes(entry.status) && (
                  <button
                    className="button button-secondary button-small"
                    disabled={busy}
                    onClick={() => void resume(entry)}
                  >
                    Check receipt
                  </button>
                )}
              </div>
            ))
          ) : (
            <p>No transactions from this browser yet.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Token transfers on chain</h2>
        <div className="demo-stack">
          {transfers.length ? (
            transfers.map((item) => (
              <div key={`${item.hash}:${item.index}`}>
                <strong>{item.label}</strong>
                <p>
                  <TransactionLink hash={item.hash} />
                </p>
              </div>
            ))
          ) : (
            <p>No transfers in the scanned blocks.</p>
          )}
          {historyStart !== null && (
            <button
              className="button button-secondary"
              onClick={() =>
                void history(historyStart).catch((reason) =>
                  setError(transactionError(reason)),
                )
              }
            >
              Load earlier 2,000 blocks
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
