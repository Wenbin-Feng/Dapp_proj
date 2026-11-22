import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import {
  Contract,
  FetchRequest,
  Interface,
  JsonRpcProvider,
  ZeroHash,
  keccak256,
  parseEther,
} from "ethers";
import { z } from "zod";
import abi from "./chain-abi.json";
import type { LocalDatabase } from "./database";
import type { Claim, Profile, Role, Transfer } from "./types";
import type { ChainStatus, PreparedTransaction } from "./chain-types";
import { ApiError } from "./http";
import {
  chainEnabled,
  chainManifest,
  type ChainManifest,
} from "./chain-config";
import {
  applyChainEvent,
  initProjection,
  roleNames,
  textCommitment,
  toChainId,
} from "./chain-projection";

const globalChain = globalThis as typeof globalThis & {
  roleRegistration?: Promise<void>;
  passportProviders?: Map<string, JsonRpcProvider>;
  passportSync?: WeakMap<LocalDatabase, Promise<void>>;
};
export const chainInterface = new Interface(abi);
export function chainProvider(d: ChainManifest): JsonRpcProvider {
  const providers = (globalChain.passportProviders ??= new Map<
    string,
    JsonRpcProvider
  >());
  let provider = providers.get(d.rpcUrl);
  if (!provider) {
    const request = new FetchRequest(d.rpcUrl);
    request.timeout = 4000;
    provider = new JsonRpcProvider(request, undefined, {
      cacheTimeout: -1,
      batchMaxCount: 1,
    });
    providers.set(d.rpcUrl, provider);
  }
  return provider;
}
export function closeChainProviders() {
  for (const p of globalChain.passportProviders?.values() || []) p.destroy();
  globalChain.passportProviders?.clear();
}
async function validateDeployment(d: ChainManifest) {
  const provider = chainProvider(d);
  const [network, code, block] = await Promise.all([
    provider.send("eth_chainId", []),
    provider.getCode(d.address),
    provider.getBlock(d.blockNumber),
  ]);
  if (
    Number(BigInt(network)) !== d.chainId ||
    code === "0x" ||
    keccak256(code) !== d.codeHash ||
    block?.hash !== d.blockHash
  )
    throw new ApiError(
      503,
      "CHAIN_CHANGED",
      "The saved contract or local chain has changed. Restore the original node, or deploy a new instance with npm run chain:deploy -- --new. Existing data is retained.",
    );
  const contract = new Contract(d.address, abi, provider);
  if ((await contract.deploymentId()) !== d.deploymentId)
    throw new ApiError(
      503,
      "CHAIN_CHANGED",
      "Contract deployment identity does not match this workspace.",
    );
  return provider;
}
interface Cursor {
  deployment_id: string;
  last_block: number;
  last_hash: string;
}
async function indexChain(db: LocalDatabase) {
  const d = chainManifest(),
    provider = await validateDeployment(d);
  initProjection(db);
  let cursor = db.get<Cursor>("SELECT * FROM chain_state WHERE singleton=1");
  if (!cursor) {
    const previous = await provider.getBlock(d.blockNumber - 1);
    db.run(
      "INSERT OR IGNORE INTO chain_state VALUES(1,?,?,?)",
      d.deploymentId,
      d.blockNumber - 1,
      previous!.hash!,
    );
    cursor = db.get<Cursor>("SELECT * FROM chain_state WHERE singleton=1")!;
  }
  if (cursor.deployment_id !== d.deploymentId)
    throw new ApiError(
      409,
      "CHAIN_DATABASE_MISMATCH",
      "This SQLite projection belongs to another deployment. Use that deployment's database.",
    );
  const checkpoint = await provider.getBlock(cursor.last_block);
  if (checkpoint?.hash !== cursor.last_hash)
    throw new ApiError(
      503,
      "CHAIN_REORG",
      "The indexed chain history changed. Stop using this projection and restore its matching node/database backup, or deploy a new local instance.",
    );
  const head = await provider.getBlockNumber();
  while (cursor.last_block < head) {
    const start = cursor.last_block,
      end = Math.min(head, start + 250);
    const logs = await provider.getLogs({
      address: d.address,
      fromBlock: start + 1,
      toBlock: end,
    });
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    const blocks = new Map(
      await Promise.all(
        [...new Set([...logs.map((l) => l.blockNumber), end])].map(
          async (number) =>
            [number, (await provider.getBlock(number))!] as const,
        ),
      ),
    );
    db.transaction(() => {
      const actual = db.get<Cursor>(
        "SELECT * FROM chain_state WHERE singleton=1",
      )!;
      if (actual.last_block !== start) return; // Another Next.js worker committed this range first.
      for (const log of logs) {
        const event = chainInterface.parseLog(log);
        if (event)
          applyChainEvent(db, event, {
            timestamp: blocks.get(log.blockNumber)!.timestamp,
            hash: log.transactionHash,
            block: log.blockNumber,
            blockHash: log.blockHash,
          });
      }
      db.run(
        "UPDATE chain_state SET last_block=?,last_hash=? WHERE singleton=1",
        end,
        blocks.get(end)!.hash!,
      );
    });
    cursor = db.get<Cursor>("SELECT * FROM chain_state WHERE singleton=1")!;
  }
}
export async function syncChain(db: LocalDatabase) {
  if (!chainEnabled()) return;
  const locks = (globalChain.passportSync ??= new WeakMap<
    LocalDatabase,
    Promise<void>
  >());
  const previous = locks.get(db);
  if (previous) {
    await previous;
    return syncChain(db);
  }
  const pending = indexChain(db).catch((error) => {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "CHAIN_UNAVAILABLE",
      "Cannot synchronize the local blockchain. Start npm run chain:node, then retry synchronization.",
    );
  });
  locks.set(db, pending);
  try {
    await pending;
  } finally {
    if (locks.get(db) === pending) locks.delete(db);
  }
}
// The administrator signer is available only on the server's loopback demo RPC.
export async function registerWalletRole(wallet: string, role: Role) {
  const previous = globalChain.roleRegistration ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    const deployment = chainManifest();
    const provider = await validateDeployment(deployment);
    const contract = new Contract(deployment.address, abi, provider);
    const selected = roleNames.indexOf(role);
    const current = Number(await contract.roles(wallet));
    if (current === selected) return;
    if (current !== 0) {
      throw new ApiError(409, "ROLE_ALREADY_SET",
        `This wallet is registered as ${roleNames[current]}. Select its registered role to continue.`);
    }
    const admin = await provider.getSigner(deployment.administrator);
    // Fund only the first enrollment on the private demo chain. A retry after
    // funding but before the grant sees the existing balance.
    if ((await provider.getBalance(wallet)) === 0n) {
      await (await admin.sendTransaction({ to: wallet, value: parseEther("0.05") })).wait();
    }
    await (await contract.connect(admin).getFunction("grantRole")(wallet, selected)).wait();
  });
  globalChain.roleRegistration = pending;
  try {
    await pending;
  } finally {
    if (globalChain.roleRegistration === pending) delete globalChain.roleRegistration;
  }
}
export async function chainStatus(
  db?: LocalDatabase,
  wallet?: string,
): Promise<ChainStatus> {
  if (!chainEnabled()) return { enabled: false, ready: false };
  let d: ChainManifest | undefined;
  try {
    d = chainManifest();
    if (db) await syncChain(db);
    else await validateDeployment(d);
    const provider = chainProvider(d);
    const role = wallet
      ? Number(await new Contract(d.address, abi, provider).roles(wallet))
      : 0;
    return {
      enabled: true,
      ready: true,
      chainId: d.chainId,
      address: d.address,
      rpcUrl: process.env.DAPP_WALLET_RPC || d.rpcUrl,
      deploymentId: d.deploymentId,
      administrator: d.administrator,
      latestBlock: await provider.getBlockNumber(),
      indexedBlock: db?.get<Cursor>(
        "SELECT * FROM chain_state WHERE singleton=1",
      )?.last_block,
      walletRole: role ? roleNames[role] : null,
    };
  } catch (error) {
    return {
      enabled: true,
      ready: false,
      ...(d
        ? {
            chainId: d.chainId,
            address: d.address,
            rpcUrl: process.env.DAPP_WALLET_RPC || d.rpcUrl,
            deploymentId: d.deploymentId,
          }
        : {}),
      error:
        error instanceof ApiError
          ? error.message
          : "The local blockchain is unavailable. Start npm run chain:node.",
    };
  }
}
const uuid = z.uuidv4(),
  wallet = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((v) => v.toLowerCase());
export const chainCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("register"),
      serial_number: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .regex(
          /^[!-~]+$/,
          "Use ASCII letters, digits or punctuation without spaces.",
        ),
      model: z.string().trim().min(1).max(120),
      warranty_duration_days: z.number().int().min(1).max(36500),
      max_claims: z.number().int().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("transfer"),
      product_id: uuid,
      to_wallet: wallet,
    })
    .strict(),
  z
    .object({
      kind: z.literal("transferAction"),
      id: uuid,
      action: z.enum(["accept", "reject", "cancel"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("claim"),
      product_id: uuid,
      service_center_id: uuid,
      description: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("claimAction"),
      id: uuid,
      action: z.enum(["approve", "reject", "complete"]),
      reason: z.string().trim().min(1).max(2000).optional(),
      resolution: z.string().trim().min(1).max(2000).optional(),
    })
    .strict(),
]);
export type ChainCommand = z.infer<typeof chainCommandSchema>;
interface Intent {
  id: string;
  actor_id: string;
  wallet: string;
  kind: ChainCommand["kind"];
  entity_id: string;
  product_id: string;
  command_json: string;
  calldata: string;
  created_at: string;
}
export async function prepareTransaction(
  db: LocalDatabase,
  userId: string,
  input: ChainCommand,
): Promise<PreparedTransaction> {
  await syncChain(db);
  const d = chainManifest(),
    profile = db.profile(userId)!;
  const role =
    db.get<{ role: number }>(
      "SELECT role FROM chain_roles WHERE wallet=?",
      profile.wallet_address,
    )?.role || 0;
  if (roleNames[role] !== profile.role)
    throw new ApiError(
      403,
      "CHAIN_ROLE_REQUIRED",
      "Your wallet needs the matching on-chain role. Ask the local deployment administrator to run npm run chain:grant -- YOUR_ADDRESS YOUR_ROLE.",
    );
  const id = "0x" + randomBytes(32).toString("hex"),
    salt = "0x" + randomBytes(32).toString("hex");
  let entityId: string = randomUUID(),
    productId: string = entityId,
    method: string,
    args: unknown[];
  if (input.kind === "register") {
    if (
      db.get(
        "SELECT id FROM products WHERE serial_key=?",
        input.serial_number.toLowerCase(),
      )
    )
      throw new ApiError(
        409,
        "SERIAL_EXISTS",
        "A product with this serial number already exists.",
      );
    method = "registerProduct";
    args = [
      id,
      toChainId(entityId),
      input.serial_number,
      input.model,
      profile.organization_name || profile.display_name,
      input.warranty_duration_days,
      input.max_claims,
    ];
  } else if (input.kind === "transfer") {
    productId = input.product_id;
    if (
      !db.get("SELECT id FROM profiles WHERE wallet_address=?", input.to_wallet)
    )
      throw new ApiError(
        400,
        "RECIPIENT_REQUIRED",
        "The recipient must sign in and complete their profile first.",
      );
    method = "requestTransfer";
    args = [id, toChainId(entityId), toChainId(productId), input.to_wallet];
  } else if (input.kind === "transferAction") {
    const t = db.get<Transfer>("SELECT * FROM transfers WHERE id=?", input.id);
    if (!t) throw new ApiError(404, "NOT_FOUND", "Transfer not found.");
    entityId = input.id;
    productId = t.product_id;
    method = "resolveTransfer";
    args = [
      id,
      toChainId(entityId),
      { accept: 1, reject: 2, cancel: 3 }[input.action],
    ];
  } else if (input.kind === "claim") {
    productId = input.product_id;
    const center = db.profile(input.service_center_id);
    if (center?.role !== "service_center")
      throw new ApiError(
        400,
        "INVALID_CENTER",
        "Choose a registered service center.",
      );
    method = "submitClaim";
    args = [
      id,
      toChainId(entityId),
      toChainId(productId),
      center.wallet_address,
      textCommitment(salt, input.description),
    ];
  } else {
    const c = db.get<Claim>("SELECT * FROM claims WHERE id=?", input.id);
    if (!c) throw new ApiError(404, "NOT_FOUND", "Claim not found.");
    const value =
      input.action === "reject"
        ? input.reason
        : input.action === "complete"
          ? input.resolution
          : undefined;
    if (input.action !== "approve" && !value)
      throw new ApiError(
        400,
        "TEXT_REQUIRED",
        "Provide a rejection reason or completed repair description.",
      );
    entityId = input.id;
    productId = c.product_id;
    method = "resolveClaim";
    args = [
      id,
      toChainId(entityId),
      { approve: 1, reject: 2, complete: 3 }[input.action],
      value ? textCommitment(salt, value) : ZeroHash,
    ];
  }
  const data = chainInterface.encodeFunctionData(method, args);
  try {
    await chainProvider(d).call({
      from: profile.wallet_address,
      to: d.address,
      data,
    });
  } catch (error) {
    const e = error as { reason?: string; code?: string };
    if (e.code === "CALL_EXCEPTION")
      throw new ApiError(
        409,
        "CONTRACT_REJECTED",
        e.reason ||
          "The smart contract rejected this operation. Refresh the product and check its current state.",
      );
    throw new ApiError(
      503,
      "CHAIN_UNAVAILABLE",
      "Cannot reach the local chain. Your business data has not changed.",
    );
  }
  // The private text is durable before broadcast. The chain stores only its salted commitment.
  db.run(
    "INSERT INTO chain_intents VALUES(?,?,?,?,?,?,?,?,?)",
    id,
    userId,
    profile.wallet_address,
    input.kind,
    entityId,
    productId,
    JSON.stringify({ ...input, salt }),
    data,
    db.now(),
  );
  return {
    id,
    entityId,
    kind: input.kind,
    wallet: profile.wallet_address,
    to: d.address,
    data,
    chainId: d.chainId,
    rpcUrl: process.env.DAPP_WALLET_RPC || d.rpcUrl,
    deploymentId: d.deploymentId,
  };
}
export async function completeTransaction(
  db: LocalDatabase,
  userId: string,
  id: string,
  hash?: string,
) {
  initProjection(db);
  const intent = db.get<Intent>(
    "SELECT * FROM chain_intents WHERE id=? AND actor_id=?",
    id,
    userId,
  );
  if (!intent)
    throw new ApiError(
      404,
      "NOT_FOUND",
      "Transaction request not found for this wallet.",
    );
  const d = chainManifest();
  await validateDeployment(d);
  if (hash) {
    const receipt = await chainProvider(d).getTransactionReceipt(hash);
    if (!receipt)
      throw new ApiError(
        409,
        "TRANSACTION_PENDING",
        "Transaction has not been mined yet. Use Resume synchronization after confirmation.",
      );
    if (receipt.status !== 1)
      throw new ApiError(
        409,
        "TRANSACTION_REVERTED",
        "The transaction reverted. No business change was applied.",
      );
    const tx = await chainProvider(d).getTransaction(hash);
    if (
      !tx ||
      tx.to?.toLowerCase() !== d.address.toLowerCase() ||
      tx.from.toLowerCase() !== intent.wallet ||
      tx.data.toLowerCase() !== intent.calldata.toLowerCase() ||
      tx.value !== 0n
    )
      throw new ApiError(
        403,
        "TRANSACTION_MISMATCH",
        "This receipt does not match the prepared wallet operation.",
      );
  }
  await syncChain(db);
  const op = db.get<{ transaction_hash: string; entity_id: string }>(
    "SELECT * FROM chain_operations WHERE operation_id=? AND actor=?",
    id,
    intent.wallet,
  );
  if (!op)
    throw new ApiError(
      409,
      "TRANSACTION_PENDING",
      "No confirmed transaction has been indexed for this request yet. Wait, then resume synchronization.",
    );
  if (hash && op.transaction_hash !== hash)
    throw new ApiError(
      409,
      "TRANSACTION_MISMATCH",
      "The supplied transaction is not the indexed operation.",
    );
  const result =
    intent.kind === "register"
      ? db.product(intent.entity_id)
      : intent.kind === "transfer" || intent.kind === "transferAction"
        ? db.get<Transfer>(
            "SELECT * FROM transfers WHERE id=?",
            intent.entity_id,
          )
        : db.get<Claim>("SELECT * FROM claims WHERE id=?", intent.entity_id);
  return {
    result,
    transaction_hash: op.transaction_hash,
    product_id: intent.product_id,
  };
}
export function productChainProof(db: LocalDatabase, id: string) {
  if (!chainEnabled()) return undefined;
  const d = chainManifest();
  return {
    chain_id: d.chainId,
    contract_address: d.address,
    transactions: db.all<{
      transaction_hash: string;
      operation: string;
      block_number: number;
      created_at: string;
    }>(
      "SELECT transaction_hash,operation,block_number,created_at FROM chain_transactions WHERE product_id=? ORDER BY block_number DESC",
      id,
    ),
  };
}
