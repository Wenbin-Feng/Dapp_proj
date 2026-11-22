import { z } from "zod";
import { route, ApiError } from "@/lib/http";
import { chainManifest, contractAtBlock, requireChainMode } from "@/lib/chain-config";
import { chainProvider, chainInterface, chainStatus } from "@/lib/chain-server";
export const GET = route(async (request) => {
  requireChainMode();
  const parsed = z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .safeParse(new URL(request.url).searchParams.get("hash"));
  if (!parsed.success)
    throw new ApiError(400, "INVALID_HASH", "Enter a valid transaction hash.");
  const status = await chainStatus();
  if (!status.ready)
    throw new ApiError(
      503,
      "CHAIN_UNAVAILABLE",
      status.error || "Local chain unavailable.",
    );
  const d = chainManifest(),
    provider = chainProvider(d),
    receipt = await provider.getTransactionReceipt(parsed.data);
  const address = receipt && contractAtBlock(d, receipt.blockNumber);
  if (!receipt || !address || receipt.to?.toLowerCase() !== address.toLowerCase())
    throw new ApiError(
      404,
      "NOT_FOUND",
      "No receipt for this contract was found.",
    );
  return Response.json({
    data: {
      hash: receipt.hash,
      status: receipt.status === 1 ? "confirmed" : "reverted",
      chain_id: d.chainId,
      contract: address,
      from: receipt.from,
      block_number: receipt.blockNumber,
      block_hash: receipt.blockHash,
      gas_used: receipt.gasUsed.toString(),
      events: receipt.logs
        .filter((l) => l.address.toLowerCase() === address.toLowerCase())
        .map((l) => chainInterface.parseLog(l)?.name)
        .filter(Boolean),
    },
  });
});
