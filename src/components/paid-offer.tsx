"use client";
import { useEffect, useState } from "react";
import { erc20Abi, getAddress, type Address } from "viem";
import { useDemoChain } from "./demo-chain-provider";
import { useWallet } from "./wallet-provider";
import { ErrorNotice } from "./ui";
import { productAbi } from "@/lib/chain/product-abi";
import { productHex } from "@/lib/chain/product-events";
import { displayAmount } from "@/lib/chain/amounts";
import { transactionError } from "@/lib/chain/transactions";
import type { Transfer } from "@/lib/types";

export function PaidOffer({
  transfer,
  disabled,
  accept,
}: {
  transfer: Transfer;
  disabled: boolean;
  accept: () => Promise<void>;
}) {
  const chain = useDemoChain();
  const wallet = useWallet();
  const [quote, setQuote] = useState<{
    price: bigint;
    allowance: bigint;
    balance: bigint;
    expires: bigint;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(
    () => setQuote(null),
    [wallet.address, transfer.id, chain.walletRevision],
  );
  async function review() {
    setLoading(true);
    setError(null);
    setQuote(null);
    try {
      const { config, client } = chain;
      if (!config?.products || !client || !wallet.address)
        throw new Error(
          "Configure the product contract and connect the buyer wallet.",
        );
      const offer = await client.readContract({
        address: config.products,
        abi: productAbi,
        functionName: "getTransfer",
        args: [productHex(transfer.id)],
      });
      const now = (await client.getBlock()).timestamp;
      if (
        offer.status !== 1 ||
        offer.buyer.toLowerCase() !== wallet.address.toLowerCase() ||
        offer.expiresAt < now
      )
        throw new Error(
          "This offer is resolved, expired or assigned to another buyer.",
        );
      if (
        offer.price !== BigInt(transfer.price_pdc || "0") ||
        getAddress(offer.seller) !== getAddress(transfer.from_wallet) ||
        offer.productId !== productHex(transfer.product_id)
      )
        throw new Error(
          "The displayed offer differs from the contract. Sync products and review it again.",
        );
      const [balance, allowance] = await Promise.all([
        client.readContract({
          address: config.pdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet.address as Address],
        }),
        client.readContract({
          address: config.pdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet.address as Address, config.products],
        }),
      ]);
      setQuote({
        price: offer.price,
        expires: offer.expiresAt,
        balance,
        allowance,
      });
    } catch (reason) {
      setError(transactionError(reason));
    } finally {
      setLoading(false);
    }
  }
  async function approve() {
    if (!quote || !chain.config?.products) return;
    try {
      await chain.invoke(
        {
          address: chain.config.pdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [chain.config.products, quote.price],
        },
        "Approve PDC purchase",
      );
      await review();
    } catch (reason) {
      setError(transactionError(reason));
    }
  }
  const busy = disabled || loading || chain.busy;
  return (
    <div className="demo-stack">
      <ErrorNotice error={error} />
      {quote ? (
        <>
          <strong>Pay {displayAmount(quote.price, 18)} PDC</strong>
          <p className="small">
            Buyer: <span className="mono">{transfer.to_wallet}</span>
            <br />
            Seller: <span className="mono">{transfer.from_wallet}</span>
            <br />
            Offer expires{" "}
            {new Date(Number(quote.expires) * 1000).toLocaleString()}
            <br />
            Spender: <span className="mono">{chain.config?.products}</span>
          </p>
          {quote.balance < quote.price ? (
            <p role="alert">Insufficient PDC. Ask the team for demo tokens.</p>
          ) : quote.allowance < quote.price ? (
            <button
              className="button button-small"
              disabled={busy}
              onClick={() => void approve()}
            >
              Approve {displayAmount(quote.price, 18)} PDC
            </button>
          ) : (
            <button
              className="button button-small"
              disabled={busy}
              onClick={() => void accept()}
            >
              Pay {displayAmount(quote.price, 18)} PDC and accept
            </button>
          )}
          <p className="small muted">
            Payment and digital ownership transfer settle together. A prior
            approval remains if settlement fails. This does not prove physical
            delivery.
          </p>
        </>
      ) : (
        <button
          className="button button-small"
          disabled={busy}
          onClick={() => void review()}
        >
          Review PDC payment
        </button>
      )}
    </div>
  );
}
