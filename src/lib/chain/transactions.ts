import {
  BaseError,
  getAddress,
  type EIP1193Provider,
  type Address,
} from "viem";

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
