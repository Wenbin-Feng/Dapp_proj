import "server-only";
import { randomUUID } from "node:crypto";
import { AbiCoder, keccak256, type LogDescription } from "ethers";
import type { LocalDatabase } from "./database";
import type { Profile, Claim, Transfer } from "./types";
import { ApiError } from "./http";
export const roleNames = [
  "none",
  "manufacturer",
  "retailer",
  "customer",
  "service_center",
] as const;
export const toChainId = (uuid: string) => "0x" + uuid.replaceAll("-", "");
export function fromChainId(bytes: string) {
  const x = bytes.slice(2);
  if (!/^[a-fA-F0-9]{32}$/.test(x)) throw Error("Invalid chain entity ID");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`.toLowerCase();
}
export const textCommitment = (salt: string, text: string) =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(["bytes32", "string"], [salt, text]),
  );
export function initProjection(db: LocalDatabase) {
  db.connection.exec(`
 CREATE TABLE IF NOT EXISTS chain_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),deployment_id TEXT NOT NULL,last_block INTEGER NOT NULL,last_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chain_roles(wallet TEXT PRIMARY KEY,role INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS chain_intents(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES accounts(id),wallet TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,product_id TEXT NOT NULL,command_json TEXT NOT NULL,calldata TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chain_operations(operation_id TEXT NOT NULL,actor TEXT NOT NULL,entity_id TEXT NOT NULL,kind INTEGER NOT NULL,transaction_hash TEXT NOT NULL,block_number INTEGER NOT NULL,PRIMARY KEY(operation_id,actor));
 CREATE TABLE IF NOT EXISTS chain_transactions(transaction_hash TEXT PRIMARY KEY,product_id TEXT NOT NULL,actor TEXT NOT NULL,operation TEXT NOT NULL,block_number INTEGER NOT NULL,block_hash TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS chain_tx_product ON chain_transactions(product_id,block_number);
 `);
}
function profileFor(
  db: LocalDatabase,
  wallet: string,
  now: string,
  organization?: string,
): Profile {
  wallet = wallet.toLowerCase();
  const role = db.get<{ role: number }>(
    "SELECT role FROM chain_roles WHERE wallet=?",
    wallet,
  )?.role;
  if (!role || role > 4)
    throw new ApiError(
      503,
      "CHAIN_INDEX_ERROR",
      "A chain participant has no role grant.",
    );
  db.run(
    "INSERT INTO accounts(id,wallet_address) VALUES(?,?) ON CONFLICT(wallet_address) DO NOTHING",
    randomUUID(),
    wallet,
  );
  const account = db.get<{ id: string }>(
    "SELECT id FROM accounts WHERE wallet_address=?",
    wallet,
  )!;
  const existing = db.profile(account.id);
  if (existing) {
    if (existing.role !== roleNames[role])
      throw new ApiError(
        409,
        "CHAIN_ROLE_MISMATCH",
        "Local profile does not match its on-chain role.",
      );
    return existing;
  }
  // Direct contract callers may not have used our UI. Index them without private personal data.
  db.run(
    "INSERT INTO profiles VALUES(?,?,?,?,?,?,?)",
    account.id,
    wallet,
    `Wallet ${wallet.slice(0, 8)}`,
    roleNames[role],
    role === 3 ? null : organization || wallet,
    now,
    now,
  );
  return db.profile(account.id)!;
}
function privateText(
  db: LocalDatabase,
  op: string,
  actor: string,
  hash: string,
  field: "description" | "reason" | "resolution",
) {
  const intent = db.get<{ command_json: string }>(
    "SELECT command_json FROM chain_intents WHERE id=? AND wallet=?",
    op,
    actor.toLowerCase(),
  );
  if (intent) {
    const input = JSON.parse(intent.command_json);
    if (
      typeof input[field] === "string" &&
      textCommitment(input.salt, input[field]).toLowerCase() ===
        hash.toLowerCase()
    )
      return input[field] as string;
  }
  return "Private text is unavailable in this local database. The commitment is recorded on-chain.";
}
export function applyChainEvent(
  db: LocalDatabase,
  event: LogDescription,
  context: {
    timestamp: number;
    hash: string;
    block: number;
    blockHash: string;
  },
) {
  const a = event.args,
    now = new Date(context.timestamp * 1000).toISOString();
  const record = (productId: string, actor: string, operation: string) =>
    db.run(
      "INSERT OR IGNORE INTO chain_transactions VALUES(?,?,?,?,?,?,?)",
      context.hash,
      productId,
      actor.toLowerCase(),
      operation,
      context.block,
      context.blockHash,
      now,
    );
  if (event.name === "RoleGranted") {
    db.run(
      "INSERT INTO chain_roles VALUES(?,?) ON CONFLICT(wallet) DO UPDATE SET role=excluded.role",
      a.wallet.toLowerCase(),
      Number(a.role),
    );
    db.run("UPDATE profiles SET role=? WHERE wallet_address=?", roleNames[Number(a.role)], a.wallet.toLowerCase());
    return;
  }
  if (event.name === "OperationRecorded") {
    db.run(
      "INSERT INTO chain_operations VALUES(?,?,?,?,?,?)",
      a.operationId,
      a.actor.toLowerCase(),
      fromChainId(a.entityId),
      Number(a.kind),
      context.hash,
      context.block,
    );
    return;
  }
  if (event.name === "ProductRegistered") {
    const id = fromChainId(a.productId),
      maker = profileFor(db, a.manufacturer, now, a.manufacturerName);
    db.run(
      "INSERT INTO products(id,serial_number,serial_key,model,manufacturer_id,manufacturer_name,manufacturer_wallet,owner_id,owner_wallet,warranty_duration_days,max_claims,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      a.serial,
      a.serial.toLowerCase(),
      a.model,
      maker.id,
      a.manufacturerName,
      maker.wallet_address,
      maker.id,
      maker.wallet_address,
      Number(a.warrantyDays),
      Number(a.maxClaims),
      now,
    );
    db.run(
      "INSERT INTO ownership_events VALUES(?,?,NULL,?,'registered',?)",
      randomUUID(),
      id,
      maker.wallet_address,
      now,
    );
    record(id, maker.wallet_address, "Product registered");
  } else if (event.name === "TransferRequested") {
    const id = fromChainId(a.transferId),
      pid = fromChainId(a.productId),
      from = profileFor(db, a.from, now),
      to = profileFor(db, a.to, now);
    db.run(
      "INSERT INTO transfers(id,product_id,from_user_id,to_user_id,from_wallet,to_wallet,status,created_at,resolved_at) VALUES(?,?,?,?,?,?,'pending',?,NULL)",
      id,
      pid,
      from.id,
      to.id,
      from.wallet_address,
      to.wallet_address,
      now,
    );
    record(pid, from.wallet_address, "Transfer requested");
  } else if (event.name === "TransferResolved") {
    const id = fromChainId(a.transferId),
      t = db.get<Transfer>("SELECT * FROM transfers WHERE id=?", id)!;
    if (!t) throw Error("Missing transfer in chain projection");
    const status = ["none", "pending", "accepted", "rejected", "cancelled"][
      Number(a.status)
    ];
    db.run(
      "UPDATE transfers SET status=?,resolved_at=? WHERE id=?",
      status,
      now,
      id,
    );
    if (status === "accepted") {
      const date = (seconds: bigint) =>
        seconds === 0n ? null : new Date(Number(seconds) * 1000).toISOString();
      db.run(
        "UPDATE products SET owner_id=?,owner_wallet=?,warranty_started_at=?,warranty_expires_at=? WHERE id=?",
        t.to_user_id,
        t.to_wallet,
        date(a.warrantyStarted),
        date(a.warrantyExpires),
        t.product_id,
      );
      db.run(
        "INSERT INTO ownership_events VALUES(?,?,?,?,'transferred',?)",
        randomUUID(),
        t.product_id,
        t.from_wallet,
        t.to_wallet,
        now,
      );
    }
    record(
      t.product_id,
      status === "cancelled" ? t.from_wallet : t.to_wallet,
      `Transfer ${status}`,
    );
  } else if (event.name === "ClaimSubmitted") {
    const id = fromChainId(a.claimId),
      pid = fromChainId(a.productId),
      customer = profileFor(db, a.customer, now),
      center = profileFor(db, a.center, now);
    db.run(
      "INSERT INTO claims VALUES(?,?,?,?,?,'submitted',NULL,NULL,?,NULL)",
      id,
      pid,
      customer.id,
      center.id,
      privateText(
        db,
        a.operationId,
        a.customer,
        a.descriptionHash,
        "description",
      ),
      now,
    );
    record(pid, customer.wallet_address, "Claim submitted");
  } else if (event.name === "ClaimResolved") {
    const id = fromChainId(a.claimId),
      c = db.get<Claim>("SELECT * FROM claims WHERE id=?", id)!;
    if (!c) throw Error("Missing claim in chain projection");
    const center = db.profile(c.service_center_id)!,
      status = ["none", "submitted", "approved", "rejected", "completed"][
        Number(a.status)
      ];
    const reason =
      status === "rejected"
        ? privateText(
            db,
            a.operationId,
            center.wallet_address,
            a.resultHash,
            "reason",
          )
        : c.decision_reason;
    const resolution =
      status === "completed"
        ? privateText(
            db,
            a.operationId,
            center.wallet_address,
            a.resultHash,
            "resolution",
          )
        : c.resolution;
    db.run(
      "UPDATE claims SET status=?,decision_reason=?,resolution=?,resolved_at=? WHERE id=?",
      status,
      reason,
      resolution,
      status === "approved" ? null : now,
      id,
    );
    if (status === "completed") {
      db.run(
        "UPDATE products SET claims_used=claims_used+1 WHERE id=?",
        c.product_id,
      );
      db.run(
        "INSERT INTO service_records VALUES(?,?,?,?,?,?)",
        randomUUID(),
        c.product_id,
        id,
        center.id,
        resolution!,
        now,
      );
    }
    record(c.product_id, center.wallet_address, `Claim ${status}`);
  }
}
