import { it, expect } from "vitest";
import { parseEther } from "viem";
import { amountOut, priceImpactBps, displayBps } from "@/lib/chain/amm";
import { minimumAmount } from "@/lib/chain/amounts";

it("quotes V2 in integer units and distinguishes price impact from slippage", () => {
  const input = parseEther("1000"),
    reserve = parseEther("100000");
  const out = amountOut(input, reserve, reserve);
  expect(out).toBe(987158034397061298850n);
  expect(minimumAmount(out)).toBe(977286454053090685861n);
  expect(displayBps(priceImpactBps(input, out, reserve, reserve))).toBe(
    "0.98%",
  );
  expect(amountOut(1n, reserve, 1n)).toBe(0n);
  expect(() => amountOut(input, 0n, reserve)).toThrow();
});
