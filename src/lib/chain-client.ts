"use client";
import { BrowserProvider } from "ethers";
import { api } from "./api-http";
import { walletTransport } from "./wallet-transport";
import type {
  ChainProgress,
  ChainStatus,
  PreparedTransaction,
} from "./chain-types";
interface Pending {
  prepared: PreparedTransaction;
  hash?: string;
}
const key = "dapp.pending-chain-operation";
let active = false;
let lastProgress: ChainProgress | null = null;
export const currentChainProgress = () => lastProgress;
export function pendingChainTransaction(): Pending | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function progress(value: ChainProgress) {
  lastProgress = value;
  window.dispatchEvent(
    new CustomEvent("dapp-chain-progress", { detail: value }),
  );
}
function save(value: Pending) {
  sessionStorage.setItem(key, JSON.stringify(value));
}
export function forgetPendingTransaction() {
  sessionStorage.removeItem(key);
  progress({
    stage: "error",
    message:
      "Request forgotten on this browser. This does not cancel a transaction already sent to the chain; refresh to synchronize its result.",
  });
}
export async function connectLocalChain(
  status: Pick<PreparedTransaction, "chainId" | "rpcUrl">,
) {
  const wallet = walletTransport();
  if (!wallet)
    throw Error("Install and unlock MetaMask to submit a transaction.");
  const expected = "0x" + status.chainId.toString(16);
  if (
    Number(
      BigInt((await wallet.request({ method: "eth_chainId" })) as string),
    ) !== status.chainId
  ) {
    try {
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: expected }],
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await wallet.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: expected,
            chainName: status.chainId === 31338 ? "Product Passport Demo" : "Product Passport - Local Hardhat",
            rpcUrls: [status.rpcUrl],
            nativeCurrency: {
              name: "Local test Ether",
              symbol: "ETH",
              decimals: 18,
            },
          },
        ],
      });
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: expected }],
      });
    }
  }
  if (
    Number(
      BigInt((await wallet.request({ method: "eth_chainId" })) as string),
    ) !== status.chainId
  )
    throw Error(`Switch MetaMask to chain ${status.chainId} before continuing.`);
  return wallet;
}
function errorMessage(error: unknown) {
  const e = error as {
    code?: string | number;
    shortMessage?: string;
    message?: string;
  };
  return e.code === 4001 || e.code === "ACTION_REJECTED"
    ? "The wallet transaction was cancelled. No new transaction was submitted."
    : e.code === "INSUFFICIENT_FUNDS"
      ? "This wallet needs local test ETH to pay transaction gas. Use a funded Hardhat test wallet."
      : e.shortMessage ||
        e.message ||
        "Transaction failed. Check the wallet and local chain.";
}
export async function resumePendingTransaction() {
  const pending = pendingChainTransaction();
  if (!pending) throw Error("No pending transaction is saved in this browser.");
  const status = await api<ChainStatus>("/api/chain/status");
  if (!status.ready || status.deploymentId !== pending.prepared.deploymentId)
    throw Error(
      status.error || "This request belongs to another chain deployment.",
    );
  progress({
    stage: "syncing",
    message: "Checking the receipt and synchronizing confirmed events…",
    hash: pending.hash,
    intentId: pending.prepared.id,
  });
  const result = await api<{
    result: unknown;
    transaction_hash: string;
    product_id: string;
  }>("/api/chain/confirm", {
    method: "POST",
    body: JSON.stringify({
      id: pending.prepared.id,
      ...(pending.hash ? { hash: pending.hash } : {}),
    }),
  });
  sessionStorage.removeItem(key);
  progress({
    stage: "confirmed",
    message: "Transaction confirmed and local data synchronized.",
    hash: result.transaction_hash,
  });
  return result;
}
export async function performMutation<T>(
  path: string,
  body: Record<string, unknown>,
  command: Record<string, unknown>,
): Promise<T> {
  const status = await api<ChainStatus>("/api/chain/status");
  if (!status.enabled)
    return api<T>(path, { method: "POST", body: JSON.stringify(body) });
  if (!status.ready) throw Error(status.error || "Local chain is unavailable.");
  if (active || pendingChainTransaction())
    throw Error(
      "Resume or resolve your pending transaction before starting another operation.",
    );
  active = true;
  let provider: BrowserProvider | undefined;
  try {
    const prepared = await api<PreparedTransaction>("/api/chain/prepare", {
      method: "POST",
      body: JSON.stringify(command),
    });
    const wallet = await connectLocalChain(prepared);
    provider = new BrowserProvider(wallet, "any");
    const signer = await provider.getSigner();
    if ((await signer.getAddress()).toLowerCase() !== prepared.wallet)
      throw Error(
        "The selected wallet differs from the signed-in account. Sign out and reconnect.",
      );
    save({ prepared });
    progress({
      stage: "signing",
      message:
        "Confirm the transaction in MetaMask. It uses local test ETH for gas.",
      intentId: prepared.id,
    });
    const tx = await signer.sendTransaction({
      to: prepared.to,
      data: prepared.data,
      value: 0,
    });
    save({ prepared, hash: tx.hash });
    progress({
      stage: "confirming",
      message: "Transaction sent. Waiting for block confirmation…",
      hash: tx.hash,
      intentId: prepared.id,
    });
    try {
      const receipt = await tx.wait(1, 60000);
      if (!receipt || receipt.status !== 1)
        throw Error("The transaction did not succeed.");
    } catch (error) {
      const e = error as {
        code?: string;
        cancelled?: boolean;
        replacement?: { hash: string };
        receipt?: { status: number };
      };
      if (
        e.code === "TRANSACTION_REPLACED" &&
        e.replacement &&
        !e.cancelled &&
        e.receipt?.status === 1
      )
        save({ prepared, hash: e.replacement.hash });
      else {
        if (e.cancelled || e.code === "CALL_EXCEPTION")
          sessionStorage.removeItem(key);
        throw error;
      }
    }
    return (await resumePendingTransaction()).result as T;
  } catch (error) {
    const e = error as { code?: number | string };
    if (
      [
        4001,
        "ACTION_REJECTED",
        "INSUFFICIENT_FUNDS",
        "CALL_EXCEPTION",
      ].includes(e.code || "")
    )
      sessionStorage.removeItem(key);
    const pending = pendingChainTransaction();
    const message =
      errorMessage(error) +
      (pending
        ? " Your request is saved. Use Resume synchronization to recover a mined transaction."
        : "");
    progress({
      stage: "error",
      message,
      hash: pending?.hash,
      intentId: pending?.prepared.id,
    });
    throw Error(message);
  } finally {
    provider?.destroy();
    active = false;
  }
}
