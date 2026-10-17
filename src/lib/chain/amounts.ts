import { formatUnits, parseUnits, maxUint256 } from "viem";

export function parseAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value))
    throw new Error("Enter a decimal amount with at most 18 decimal places.");
  const amount = parseUnits(value, 18);
  if (amount <= 0n || amount > maxUint256)
    throw new Error(
      "Enter an amount greater than zero within the token limit.",
    );
  return amount;
}

export function displayAmount(amount: bigint, places = 6): string {
  const [whole, fraction] = formatUnits(amount, 18).split(".");
  const decimals = fraction?.slice(0, places).replace(/0+$/, "");
  return `${whole}${decimals ? `.${decimals}` : ""}`;
}

export const SLIPPAGE_BPS = 100n;
export const DEADLINE_SECONDS = 600n;
export const minimumAmount = (amount: bigint) =>
  (amount * (10000n - SLIPPAGE_BPS)) / 10000n;
