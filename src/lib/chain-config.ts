import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "./http";
export const chainEnabled = () => process.env.CHAIN_ENABLED === "1";
const manifestSchema = z.object({
  version: z.literal(1),
  chainId: z.union([z.literal(31337), z.literal(31338)]),
  rpcUrl: z.url(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  deploymentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockNumber: z.number().int().nonnegative(),
  blockHash: z.string(),
  databasePath: z.string().min(1),
  administrator: z.string(),
  predecessor: z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), blockNumber: z.number().int().positive() }).optional(),
});
export type ChainManifest = z.infer<typeof manifestSchema>;
export function chainManifest(): ChainManifest {
  try {
    const file = resolve(
      /* turbopackIgnore: true */ process.env.CHAIN_DEPLOYMENT_FILE ||
        "data/chain/deployment.json",
    );
    const data = manifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    const endpoint = new URL(process.env.CHAIN_RPC_URL || data.rpcUrl);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
      endpoint.protocol !== "http:"
    )
      throw Error("Local RPC required");
    return { ...data, rpcUrl: endpoint.href };
  } catch {
    throw new ApiError(
      503,
      "CHAIN_NOT_CONFIGURED",
      "Local chain is not configured. Start the Hardhat node and run npm run chain:deploy.",
    );
  }
}
export function requireChainMode() {
  if (!chainEnabled())
    throw new ApiError(
      409,
      "CHAIN_DISABLED",
      "This workspace is using local database mode.",
    );
}
export function requireDatabaseMode() {
  if (chainEnabled())
    throw new ApiError(
      409,
      "WALLET_TRANSACTION_REQUIRED",
      "Confirm this operation as a wallet transaction. Direct database mutations are disabled in chain mode.",
    );
}


export function contractAtBlock(d: ChainManifest, block: number) {
  return d.predecessor && block < d.blockNumber ? d.predecessor.address : d.address;
}
