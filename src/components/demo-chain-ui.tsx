"use client";

import type { ReactNode } from "react";
import type { Hash } from "viem";
import { useDemoChain } from "./demo-chain-provider";
import { ErrorNotice, Loading } from "./ui";

export function TransactionLink({
  hash,
  children,
}: {
  hash: Hash;
  children?: ReactNode;
}) {
  const { config } = useDemoChain();
  return config?.chainId === 11155111 ? (
    <a
      className="text-link mono"
      target="_blank"
      rel="noreferrer"
      href={`https://sepolia.etherscan.io/tx/${hash}`}
    >
      {children || `${hash.slice(0, 10)}…${hash.slice(-8)}`}
    </a>
  ) : (
    <span className="mono small" title={hash}>
      {children || hash}
    </span>
  );
}

export function ChainNotice() {
  const chain = useDemoChain();
  return (
    <>
      {chain.config && (
        <div className="notice">
          <span>
            <strong>
              {chain.config.chainId === 31337
                ? "Hardhat local"
                : "Sepolia testnet"}{" "}
              · Demo assets only
            </strong>
            <br />
            PDC and PDQ have no promised monetary value. Test ETH is required
            for gas.
          </span>
        </div>
      )}
      <ErrorNotice error={chain.error} />
      {chain.message && (
        <div className="notice" role="status">
          {chain.message}
        </div>
      )}
    </>
  );
}

export function ChainGate({ children }: { children: ReactNode }) {
  const chain = useDemoChain();
  if (chain.loading) return <Loading text="Loading the demo network…" />;
  if (!chain.config)
    return (
      <div className="panel">
        <h2>Demo network is not configured</h2>
        <p>
          The team needs to deploy the test contracts and configure this website
          before token operations are available.
        </p>
        <ErrorNotice error={chain.error} />
      </div>
    );
  return (
    <>
      <ChainNotice />
      {children}
    </>
  );
}
