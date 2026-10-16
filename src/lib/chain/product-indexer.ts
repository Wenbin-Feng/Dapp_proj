import {
  getAddress,
  type Address,
  type Hash,
  type createPublicClient,
} from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/http";
import type { DemoConfig } from "./config";
import { productAbi } from "./product-abi";
import { productReceiptEvents } from "./product-events";

export type ProductConfig = DemoConfig & { products: Address };
export type ProductClient = ReturnType<typeof createPublicClient>;
type Cursor = { next_block: string; anchor_hash: Hash | null };
export type SyncResult = {
  next_block: string;
  target_block: string;
  backlog: boolean;
  indexed: boolean;
  reset: boolean;
  event_count: number;
};

export function chainDatabaseError(error: {
  code?: string;
  message?: string;
}): never {
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code || ""))
    throw new ApiError(
      503,
      "CHAIN_SETUP_REQUIRED",
      "Apply the demo-chain SQL migration before enabling product settlement.",
    );
  throw new ApiError(
    503,
    "CHAIN_INDEX_UNAVAILABLE",
    "The chain read model could not be updated. The on-chain transaction may already be confirmed; sync again instead of resubmitting it.",
  );
}

export async function checkProductDeployment(
  client: ProductClient,
  config: ProductConfig,
) {
  if ((await client.getChainId()) !== config.chainId)
    throw new ApiError(
      503,
      "CHAIN_MISMATCH",
      "The configured RPC is on a different network.",
    );
  const [token, version] = await Promise.all([
    client.readContract({
      address: config.products,
      abi: productAbi,
      functionName: "paymentToken",
    }),
    client.readContract({
      address: config.products,
      abi: productAbi,
      functionName: "schemaVersion",
    }),
  ]);
  if (getAddress(token) !== config.pdc || version !== 1n)
    throw new ApiError(
      503,
      "CONTRACT_MISMATCH",
      "Product contract version or payment token differs from the configured deployment.",
    );
}

export async function verifiedProductReceipt(
  client: ProductClient,
  config: ProductConfig,
  hash: Hash,
  head: bigint,
) {
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch {
    throw new ApiError(
      400,
      "INVALID_EVIDENCE",
      "No mined transaction matches this hash on the configured network.",
    );
  }
  if (receipt.status !== "success")
    throw new ApiError(
      400,
      "INVALID_EVIDENCE",
      "A reverted transaction cannot change the read model.",
    );
  const confirmations = config.chainId === 31337 ? 1n : 2n;
  if (head < receipt.blockNumber + confirmations - 1n)
    throw new ApiError(
      409,
      "CHAIN_CONFIRMING",
      "The transaction is mined and is waiting for chain confirmations.",
    );
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash !== receipt.blockHash)
    throw new ApiError(
      409,
      "CHAIN_REORG",
      "The transaction block changed. Wait and check its canonical receipt again.",
    );
  let events;
  try {
    events = productReceiptEvents(receipt, config);
  } catch {
    throw new ApiError(
      400,
      "INVALID_EVIDENCE",
      "Product ownership and payment evidence do not agree.",
    );
  }
  if (!events.length)
    throw new ApiError(
      400,
      "INVALID_EVIDENCE",
      "This receipt has no event from the configured product contract.",
    );
  return events;
}

export async function syncProductIndex(
  client: ProductClient,
  db: SupabaseClient,
  config: ProductConfig,
  transactionHash?: Hash,
): Promise<SyncResult> {
  await checkProductDeployment(client, config);
  const head = await client.getBlockNumber({ cacheTime: 0 });
  // Verify a user-supplied hash before any database write, including cursor creation.
  if (transactionHash)
    await verifiedProductReceipt(client, config, transactionHash, head);
  const scope = {
    chain_id: config.chainId,
    contract_address: config.products.toLowerCase(),
  };
  const read = await db
    .from("dapp_demo_chain_sync")
    .select("next_block,anchor_hash")
    .match(scope)
    .maybeSingle();
  if (read.error) chainDatabaseError(read.error);
  const fromBlock = BigInt(config.productsFromBlock || config.fromBlock);
  const saved = read.data as Cursor | null;
  let next = BigInt(saved?.next_block || fromBlock.toString());
  let reset = false;
  if (saved?.anchor_hash) {
    const anchor = next - 1n;
    const canonical =
      anchor <= head ? await client.getBlock({ blockNumber: anchor }) : null;
    if (canonical?.hash !== saved.anchor_hash) {
      const result = await db.rpc("dapp_demo_reset_index", {
        p_chain_id: scope.chain_id,
        p_contract: scope.contract_address,
        p_expected_next: next.toString(),
        p_expected_anchor: saved.anchor_hash,
        p_from_block: fromBlock.toString(),
      });
      if (result.error) chainDatabaseError(result.error);
      if (!result.data)
        throw new ApiError(
          409,
          "INDEX_BUSY",
          "Another indexer advanced the cursor. Sync again.",
        );
      next = fromBlock;
      reset = true;
    }
  }
  const target = config.chainId === 31337 ? head : head > 0n ? head - 1n : 0n;
  let eventCount = 0;
  if (next <= target) {
    const end = next + 1999n < target ? next + 1999n : target;
    const logs = await client.getLogs({
      address: config.products,
      fromBlock: next,
      toBlock: end,
    });
    if (logs.length > 1000)
      throw new ApiError(
        503,
        "INDEX_BATCH_DENSE",
        "This demo index batch is too dense. Reduce the deployment scan range before retrying.",
      );
    const hashes = [...new Set(logs.map((log) => log.transactionHash))];
    const events = [];
    for (let offset = 0; offset < hashes.length; offset += 20) {
      const verified = await Promise.all(
        hashes
          .slice(offset, offset + 20)
          .map((hash) => verifiedProductReceipt(client, config, hash, head)),
      );
      events.push(...verified.flat());
    }
    events.sort((a, b) =>
      BigInt(a.block_number) > BigInt(b.block_number)
        ? 1
        : BigInt(a.block_number) < BigInt(b.block_number)
          ? -1
          : a.log_index - b.log_index,
    );
    if (
      events.some(
        (event) =>
          BigInt(event.block_number) < next || BigInt(event.block_number) > end,
      )
    )
      throw new ApiError(
        409,
        "CHAIN_REORG",
        "Receipt blocks moved outside the scanned range. Retry synchronization.",
      );
    const anchor = await client.getBlock({ blockNumber: end });
    const write = await db.rpc("dapp_demo_ingest_events", {
      p_chain_id: scope.chain_id,
      p_contract: scope.contract_address,
      p_expected_next: next.toString(),
      p_next: (end + 1n).toString(),
      p_anchor: anchor.hash,
      p_events: events,
    });
    if (write.error) chainDatabaseError(write.error);
    next = BigInt(write.data.next_block);
    eventCount = write.data.event_count || 0;
  }
  let indexed = !transactionHash;
  if (transactionHash) {
    const evidence = await db
      .from("dapp_demo_chain_events")
      .select("transaction_hash")
      .match(scope)
      .eq("transaction_hash", transactionHash)
      .limit(1);
    if (evidence.error) chainDatabaseError(evidence.error);
    indexed = !!evidence.data?.length;
  }
  return {
    next_block: next.toString(),
    target_block: target.toString(),
    backlog: next <= target,
    indexed,
    reset,
    event_count: eventCount,
  };
}
