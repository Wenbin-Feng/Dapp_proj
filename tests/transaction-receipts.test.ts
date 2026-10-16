import { it, expect, vi } from "vitest";
import {
  confirmTransaction,
  type TransactionEntry,
  type ReceiptClient,
} from "@/lib/chain/transactions";
import type {
  Hash,
  TransactionReceipt,
  WaitForTransactionReceiptParameters,
} from "viem";
const hash = `0x${"1".repeat(64)}` as Hash,
  replacement = `0x${"2".repeat(64)}` as Hash;
const entry: TransactionEntry = {
  hash,
  account: `0x${"1".repeat(40)}`,
  chainId: 31337,
  label: "Transfer PDC",
  status: "pending",
  createdAt: new Date().toISOString(),
};
const receipt = (transactionHash = hash, status = "success") =>
  ({ transactionHash, status }) as TransactionReceipt;
function rpc(
  wait: (
    parameters: WaitForTransactionReceiptParameters,
  ) => Promise<TransactionReceipt>,
) {
  return { waitForTransactionReceipt: vi.fn(wait) } as unknown as ReceiptClient;
}

it("distinguishes mined from confirmed on Sepolia", async () => {
  const record = vi.fn();
  let release!: (receipt: TransactionReceipt) => void;
  const client = rpc(async (parameters) =>
    parameters.confirmations === 1
      ? receipt()
      : new Promise((resolve) => {
          release = resolve;
        }),
  );
  const result = confirmTransaction(
    client,
    { ...entry, chainId: 11155111 },
    record,
  );
  await vi.waitFor(() =>
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirming" }),
    ),
  );
  expect(record).not.toHaveBeenCalledWith(
    expect.objectContaining({ status: "confirmed" }),
  );
  release(receipt());
  await expect(result).resolves.toBe(hash);
  expect(record).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "confirmed" }),
  );
});
it("keeps a receipt timeout pending, rather than reporting success or definite failure", async () => {
  const record = vi.fn();
  await expect(
    confirmTransaction(
      rpc(async () => {
        throw new Error("Receipt timeout");
      }),
      entry,
      record,
    ),
  ).rejects.toThrow("timeout");
  expect(record).not.toHaveBeenCalled();
});
it("rejects a reverted receipt", async () => {
  const record = vi.fn();
  await expect(
    confirmTransaction(
      rpc(async () => receipt(hash, "reverted")),
      entry,
      record,
    ),
  ).rejects.toThrow("reverted");
  expect(record).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "failed" }),
  );
});
it("follows a repriced transaction with unchanged operation", async () => {
  const record = vi.fn();
  const client = rpc(async (parameters) => {
    parameters.onReplaced?.({
      reason: "repriced",
      transactionReceipt: receipt(replacement),
    } as never);
    return receipt(replacement);
  });
  await expect(confirmTransaction(client, entry, record)).resolves.toBe(
    replacement,
  );
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({ hash, status: "failed" }),
  );
  expect(record).toHaveBeenLastCalledWith(
    expect.objectContaining({ hash: replacement, status: "confirmed" }),
  );
});
it.each(["cancelled", "replaced"] as const)(
  "does not report the original operation as successful when %s",
  async (reason) => {
    const record = vi.fn();
    const client = rpc(async (parameters) => {
      parameters.onReplaced?.({
        reason,
        transactionReceipt: receipt(replacement),
      } as never);
      return receipt(replacement);
    });
    await expect(confirmTransaction(client, entry, record)).rejects.toThrow(
      "original operation is not confirmed",
    );
    expect(record).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed" }),
    );
  },
);
