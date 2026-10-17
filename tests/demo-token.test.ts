import { describe, it, expect } from "vitest";
import { parseAmount, minimumAmount, displayAmount } from "@/lib/chain/amounts";
import { deploymentSchema } from "@/lib/chain/config";
import { assertWalletContext } from "@/lib/chain/transactions";
import type { EIP1193Provider } from "viem";

describe("token inputs and wallet boundaries", () => {
  it("uses exact base units and rejects rounding, exponent and negative input", () => {
    expect(parseAmount("1000000.000000000000000001")).toBe(
      1000000000000000000000001n,
    );
    for (const value of [
      "0",
      "-1",
      "1e3",
      "1.0000000000000000001",
      ".5",
      "01",
      "NaN",
      " 1",
    ])
      expect(() => parseAmount(value)).toThrow();
    expect(minimumAmount(1234567890123456789n)).toBe(1222222211222222221n);
    expect(displayAmount(987158034397061298850n)).toBe("987.158034");
  });
  it("does not allow mainnet or duplicate token addresses", () => {
    const input = {
      version: "demo-v1",
      chainId: 31337,
      treasury: `0x${"1".repeat(40)}`,
      pdc: `0x${"2".repeat(40)}`,
      pdq: `0x${"3".repeat(40)}`,
      fromBlock: "0",
    };
    expect(deploymentSchema.safeParse(input).success).toBe(true);
    expect(deploymentSchema.safeParse({ ...input, chainId: 1 }).success).toBe(
      false,
    );
    expect(
      deploymentSchema.safeParse({ ...input, pdq: input.pdc }).success,
    ).toBe(false);
  });
  it("stops a changed wallet or network before sending", async () => {
    const account = `0x${"1".repeat(40)}` as const;
    const provider = (chain: string, accounts: string[]) =>
      ({
        request: async ({ method }: { method: string }) =>
          method === "eth_accounts" ? accounts : chain,
      }) as EIP1193Provider;
    await expect(
      assertWalletContext(provider("0x7a69", [account]), account, 31337),
    ).resolves.toBeUndefined();
    await expect(
      assertWalletContext(provider("0x1", [account]), account, 31337),
    ).rejects.toThrow("Switch MetaMask");
    await expect(
      assertWalletContext(provider("0x7a69", []), account, 31337),
    ).rejects.toThrow("account changed");
  });
});
