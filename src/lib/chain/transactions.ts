import {
  BaseError,
  getAddress,
  type EIP1193Provider,
  type Address,
  type Hash,
  type createPublicClient,
  type WaitForTransactionReceiptParameters,
} from "viem";

export type TransactionEntry = {
  hash: Hash;
  account: Address;
  chainId: number;
  label: string;
  status: "pending" | "confirming" | "confirmed" | "failed";
  createdAt: string;
};
export type ReceiptClient = Pick<
  ReturnType<typeof createPublicClient>,
  "waitForTransactionReceipt"
>;
export class ReceiptRejectedError extends Error {}

export async function confirmTransaction(
  rpc: ReceiptClient,
  entry: TransactionEntry,
  record: (entry: TransactionEntry) => void,
): Promise<Hash> {
  let current = entry;
  let differentOperation = false;
  const onReplaced: NonNullable<
    WaitForTransactionReceiptParameters["onReplaced"]
  > = ({ reason, transactionReceipt }) => {
    record({ ...current, status: "failed" });
    current = {
      ...current,
      hash: transactionReceipt.transactionHash,
      status: "pending",
    };
    if (reason !== "repriced") {
      differentOperation = true;
      return;
    }
    record(current);
  };
  const wait = (confirmations: number) =>
    rpc.waitForTransactionReceipt({
      hash: current.hash,
      confirmations,
      timeout: 120_000,
      onReplaced,
    });
  const check = (status: string) => {
    if (differentOperation)
      throw new ReceiptRejectedError(
        "The original transaction was cancelled or replaced by a different operation. Check the replacement in your wallet; the original operation is not confirmed.",
      );
    if (status !== "success") {
      record({ ...current, status: "failed" });
      throw new ReceiptRejectedError("The transaction reverted. Gas may have been spent.");
    }
  };
  const included = await wait(1);
  check(included.status);
  if (entry.chainId !== 31337) {
    record({ ...current, status: "confirming" });
    const confirmed = await wait(2);
    check(confirmed.status);
  }
  record({ ...current, status: "confirmed" });
  return current.hash;
}

export async function assertWalletContext(
  provider: EIP1193Provider,
  account: Address,
  chainId: number,
) {
  const [accounts, activeChain] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
  ]);
  if (!accounts[0] || getAddress(accounts[0]) !== getAddress(account))
    throw new Error(
      "The wallet account changed. Connect the original account and review the operation again.",
    );
  if (Number(activeChain) !== chainId)
    throw new Error(
      `Switch MetaMask to ${chainId === 31337 ? "Hardhat local (31337)" : "Sepolia (11155111)"} and review the operation again.`,
    );
}

export function transactionError(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 4001
  )
    return "The wallet request was cancelled. No new transaction was submitted.";
  return error instanceof Error
    ? error.message
    : "The transaction could not be completed.";
}
