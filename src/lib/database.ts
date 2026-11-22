import "server-only";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "./http";
import {
  chainEnabled,
  chainManifest,
  requireDatabaseMode,
} from "./chain-config";
import type {
  Profile,
  Product,
  Transfer,
  Claim,
  Role,
  ServiceRecord,
  OwnershipEvent,
  ProductDetail,
  PublicProductDetail,
  CatalogProduct,
} from "./types";

const schema = `
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS profiles(
 id TEXT PRIMARY KEY REFERENCES accounts(id), wallet_address TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 80),
 role TEXT NOT NULL CHECK(role IN ('manufacturer','retailer','customer','service_center')),
 organization_name TEXT, onboarding_completed_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(
 id TEXT PRIMARY KEY, serial_number TEXT NOT NULL CHECK(length(trim(serial_number)) BETWEEN 1 AND 120),
 serial_key TEXT NOT NULL UNIQUE, model TEXT NOT NULL CHECK(length(trim(model)) BETWEEN 1 AND 120),
 manufacturer_id TEXT NOT NULL REFERENCES profiles(id), manufacturer_name TEXT NOT NULL, manufacturer_wallet TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES profiles(id), owner_wallet TEXT NOT NULL,
 warranty_duration_days INTEGER NOT NULL CHECK(warranty_duration_days BETWEEN 1 AND 36500),
 max_claims INTEGER NOT NULL CHECK(max_claims BETWEEN 1 AND 1000),
 claims_used INTEGER NOT NULL DEFAULT 0 CHECK(claims_used BETWEEN 0 AND max_claims),
 warranty_started_at TEXT, warranty_expires_at TEXT, image_path TEXT, created_at TEXT NOT NULL,
 CHECK((warranty_started_at IS NULL AND warranty_expires_at IS NULL) OR
 (warranty_started_at IS NOT NULL AND warranty_expires_at IS NOT NULL AND warranty_expires_at > warranty_started_at)));
CREATE INDEX IF NOT EXISTS products_owner ON products(owner_id);
CREATE TABLE IF NOT EXISTS transfers(
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 from_user_id TEXT NOT NULL REFERENCES profiles(id), to_user_id TEXT NOT NULL REFERENCES profiles(id),
 from_wallet TEXT NOT NULL, to_wallet TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled')),
 created_at TEXT NOT NULL, resolved_at TEXT, CHECK(from_user_id <> to_user_id));
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_transfer ON transfers(product_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS transfers_from ON transfers(from_user_id);
CREATE INDEX IF NOT EXISTS transfers_to ON transfers(to_user_id);
CREATE TABLE IF NOT EXISTS claims(
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 customer_id TEXT NOT NULL REFERENCES profiles(id), service_center_id TEXT NOT NULL REFERENCES profiles(id),
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 2000),
 status TEXT NOT NULL CHECK(status IN ('submitted','approved','rejected','completed')),
 decision_reason TEXT, resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_claim ON claims(product_id) WHERE status IN ('submitted','approved');
CREATE INDEX IF NOT EXISTS claims_customer ON claims(customer_id);
CREATE INDEX IF NOT EXISTS claims_center ON claims(service_center_id);
CREATE TABLE IF NOT EXISTS ownership_events(
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), from_wallet TEXT,
 to_wallet TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('registered','transferred')), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS history_product ON ownership_events(product_id,created_at);
CREATE TABLE IF NOT EXISTS service_records(
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), claim_id TEXT NOT NULL UNIQUE REFERENCES claims(id),
 service_center_id TEXT NOT NULL REFERENCES profiles(id), description TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS challenges(
 id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, origin TEXT NOT NULL, message TEXT NOT NULL,
 binding_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS challenge_expiry ON challenges(expires_at);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
PRAGMA user_version=1;
`;

const productColumns =
  "id,serial_number,model,manufacturer_id,manufacturer_name,manufacturer_wallet,owner_id,owner_wallet,warranty_duration_days,max_claims,claims_used,warranty_started_at,warranty_expires_at,image_path,created_at";
function invalid(message: string): never {
  throw new ApiError(400, "INVALID_INPUT", message);
}
function forbidden(message: string): never {
  throw new ApiError(403, "FORBIDDEN", message);
}
function conflict(message: string): never {
  throw new ApiError(409, "CONFLICT", message);
}
function text(value: string | null | undefined, max: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    invalid(`${label} must contain 1 to ${max} characters.`);
  return value.trim();
}

export class LocalDatabase {
  readonly connection: DatabaseSync;
  constructor(
    path: string,
    readonly clock: () => number = Date.now,
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;",
    );
    const version = this.get<{ user_version: number }>(
      "PRAGMA user_version",
    )!.user_version;
    if (version > 1) {
      this.connection.close();
      throw new Error("Database schema is newer than this application.");
    }
    this.transaction(() => {
      this.connection.exec(schema);
      if (!this.all<{name: string}>("PRAGMA table_info(transfers)").some(c => c.name === "retail_sale")) {
        this.connection.exec(`ALTER TABLE transfers ADD COLUMN retail_sale INTEGER NOT NULL DEFAULT 0;
          UPDATE transfers SET retail_sale=1 WHERE status='pending' AND from_user_id IN
          (SELECT id FROM profiles WHERE role='retailer') AND to_user_id IN (SELECT id FROM profiles WHERE role='customer');`);
      }
    });
  }
  get<T>(sql: string, ...parameters: SQLInputValue[]): T | undefined {
    return this.connection.prepare(sql).get(...parameters) as T | undefined;
  }
  all<T>(sql: string, ...parameters: SQLInputValue[]): T[] {
    return this.connection.prepare(sql).all(...parameters) as T[];
  }
  run(sql: string, ...parameters: SQLInputValue[]) {
    return this.connection.prepare(sql).run(...parameters);
  }
  now() {
    return new Date(this.clock()).toISOString();
  }
  transaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.connection.close();
  }
  profile(id: string) {
    return this.get<Profile>("SELECT * FROM profiles WHERE id=?", id) ?? null;
  }
  product(id: string) {
    return (
      this.get<Product>(
        `SELECT ${productColumns} FROM products WHERE id=?`,
        id,
      ) ?? null
    );
  }
  private requireProduct(id: string) {
    const p = this.product(id);
    if (!p) throw new ApiError(404, "NOT_FOUND", "Product not found.");
    return p;
  }
  onboard(
    id: string,
    wallet: string,
    input: {
      display_name: string;
      role: Role;
      organization_name?: string | null;
    },
  ) {
    return this.transaction(() => {
      const existing = this.profile(id);
      if (existing) {
        if (existing.wallet_address !== wallet)
          forbidden("Wallet binding mismatch.");
        return existing;
      }
      const account = this.get<{ wallet_address: string }>(
        "SELECT wallet_address FROM accounts WHERE id=?",
        id,
      );
      if (!account || account.wallet_address !== wallet)
        forbidden("Verified wallet required.");
      const name = text(input.display_name, 80, "Display name");
      if (
        !["manufacturer", "retailer", "customer", "service_center"].includes(
          input.role,
        )
      )
        invalid("Choose a valid role.");
      const org =
        input.role === "customer"
          ? input.organization_name?.trim() || null
          : text(input.organization_name, 120, "Organization name");
      if (org && org.length > 120) invalid("Organization name is too long.");
      const now = this.now();
      this.run(
        "INSERT INTO profiles VALUES(?,?,?,?,?,?,?)",
        id,
        wallet,
        name,
        input.role,
        org,
        now,
        now,
      );
      return this.profile(id)!;
    });
  }
  updateProfile(id: string, name: string, organization: string | null, selectedRole?: Role) {
    return this.transaction(() => {
      const profile = this.profile(id);
      if (!profile) forbidden("Complete your profile first.");
      const role = selectedRole ?? profile.role;
      const org =
        role === "customer"
          ? organization?.trim() || null
          : text(organization, 120, "Organization name");
      if (org && org.length > 120) invalid("Organization name is too long.");
      this.run(
        "UPDATE profiles SET display_name=?,organization_name=?,role=? WHERE id=?",
        text(name, 80, "Display name"),
        org,
        role,
        id,
      );
      return this.profile(id)!;
    });
  }
  register(
    actor: string,
    input: {
      serial_number: string;
      manufacturer_name?: string;
      model: string;
      warranty_duration_days: number;
      max_claims: number;
    },
  ) {
    requireDatabaseMode();
    return this.transaction(() => {
      const maker = this.profile(actor);
      if (maker?.role !== "manufacturer")
        forbidden("Only manufacturers can register products.");
      const serial = text(input.serial_number, 120, "Serial number");
      const model = text(input.model, 120, "Product model");
      if (
        !Number.isInteger(input.warranty_duration_days) ||
        input.warranty_duration_days < 1 ||
        input.warranty_duration_days > 36500 ||
        !Number.isInteger(input.max_claims) ||
        input.max_claims < 1 ||
        input.max_claims > 1000
      )
        invalid("Invalid warranty terms.");
      if (
        this.get(
          "SELECT id FROM products WHERE serial_key=?",
          serial.toLowerCase(),
        )
      )
        conflict("A product with this serial number already exists.");
      const id = randomUUID(),
        now = this.now();
      this.run(
        "INSERT INTO products(id,serial_number,serial_key,model,manufacturer_id,manufacturer_name,manufacturer_wallet,owner_id,owner_wallet,warranty_duration_days,max_claims,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        serial,
        serial.toLowerCase(),
        model,
        actor,
        text(input.manufacturer_name ?? (maker.organization_name || maker.display_name), 120, "Manufacturer name"),
        maker.wallet_address,
        actor,
        maker.wallet_address,
        input.warranty_duration_days,
        input.max_claims,
        now,
      );
      this.run(
        "INSERT INTO ownership_events VALUES(?,?,NULL,?,'registered',?)",
        randomUUID(),
        id,
        maker.wallet_address,
        now,
      );
      return this.product(id)!;
    });
  }
  requestTransfer(actor: string, productId: string, wallet: string) {
    requireDatabaseMode();
    return this.transaction(() => {
      const p = this.requireProduct(productId);
      if (p.owner_id !== actor)
        forbidden("Only the current owner can transfer this product.");
      const from = this.profile(actor)!;
      const to = this.get<Profile>(
        "SELECT * FROM profiles WHERE wallet_address=?",
        wallet.trim().toLowerCase(),
      );
      if (!to)
        invalid("The recipient must sign in and complete their profile first.");
      if (to.id === actor) invalid("Choose a different recipient.");
      if (
        !(
          (from.role === "manufacturer" && to.role === "retailer") ||
          (from.role === "retailer" && to.role === "customer") ||
          (from.role === "customer" && to.role === "customer")
        )
      )
        invalid(
          "Transfers follow manufacturer to retailer, retailer to customer, or customer to customer.",
        );
      if (
        this.get(
          "SELECT id FROM claims WHERE product_id=? AND status IN ('submitted','approved')",
          productId,
        )
      )
        conflict("Finish the open warranty claim before transferring.");
      const pending = this.get<Transfer>(
        "SELECT * FROM transfers WHERE product_id=? AND status='pending'",
        productId,
      );
      if (pending) {
        if (pending.to_user_id === to.id && pending.from_user_id === actor)
          return pending;
        conflict("A transfer is already awaiting confirmation.");
      }
      const id = randomUUID();
      this.run(
        "INSERT INTO transfers(id,product_id,from_user_id,to_user_id,from_wallet,to_wallet,status,created_at,resolved_at,retail_sale) VALUES(?,?,?,?,?,?,'pending',?,NULL,?)",
        id,
        productId,
        actor,
        to.id,
        from.wallet_address,
        to.wallet_address,
        this.now(),
        Number(from.role === "retailer" && to.role === "customer"),
      );
      return this.get<Transfer>("SELECT * FROM transfers WHERE id=?", id)!;
    });
  }
  transferAction(
    actor: string,
    id: string,
    action: "accept" | "reject" | "cancel",
  ) {
    requireDatabaseMode();
    return this.transaction(() => {
      const t = this.get<Transfer & {retail_sale: number}>("SELECT * FROM transfers WHERE id=?", id);
      if (!t) throw new ApiError(404, "NOT_FOUND", "Transfer not found.");
      if (!["accept", "reject", "cancel"].includes(action))
        invalid("Invalid transfer action.");
      if ((action === "cancel" ? t.from_user_id : t.to_user_id) !== actor)
        forbidden("You cannot perform this transfer action.");
      const status = {
        accept: "accepted",
        reject: "rejected",
        cancel: "cancelled",
      }[action];
      if (t.status === status) return t;
      if (t.status !== "pending")
        conflict("This transfer has already been resolved.");
      const p = this.requireProduct(t.product_id);
      if (p.owner_id !== t.from_user_id)
        conflict("The sender no longer owns this product.");
      if (
        this.get(
          "SELECT id FROM claims WHERE product_id=? AND status IN ('submitted','approved')",
          p.id,
        )
      )
        conflict("Finish the open warranty claim before transferring.");
      const now = this.now();
      if (action === "accept") {
        const starts =
          !p.warranty_started_at &&
          t.retail_sale === 1;
        this.run(
          "UPDATE products SET owner_id=?,owner_wallet=?,warranty_started_at=?,warranty_expires_at=? WHERE id=?",
          t.to_user_id,
          t.to_wallet,
          starts ? now : p.warranty_started_at,
          starts
            ? new Date(
                Date.parse(now) + p.warranty_duration_days * 86400000,
              ).toISOString()
            : p.warranty_expires_at,
          p.id,
        );
        this.run(
          "INSERT INTO ownership_events VALUES(?,?,?,?,'transferred',?)",
          randomUUID(),
          p.id,
          t.from_wallet,
          t.to_wallet,
          now,
        );
      }
      this.run(
        "UPDATE transfers SET status=?,resolved_at=? WHERE id=?",
        status,
        now,
        id,
      );
      return this.get<Transfer>("SELECT * FROM transfers WHERE id=?", id)!;
    });
  }
  submitClaim(
    actor: string,
    productId: string,
    centerId: string,
    description: string,
  ) {
    requireDatabaseMode();
    return this.transaction(() => {
      const p = this.requireProduct(productId);
      if (p.owner_id !== actor || this.profile(actor)?.role !== "customer")
        forbidden(
          "Only the current customer owner can request warranty service.",
        );
      if (
        this.get(
          "SELECT id FROM transfers WHERE product_id=? AND status='pending'",
          p.id,
        )
      )
        conflict("Resolve the pending transfer before requesting service.");
      if (
        this.get(
          "SELECT id FROM claims WHERE product_id=? AND status IN ('submitted','approved')",
          p.id,
        )
      )
        conflict("A warranty claim is already open.");
      if (
        !p.warranty_started_at ||
        !p.warranty_expires_at ||
        this.clock() >= Date.parse(p.warranty_expires_at) ||
        p.claims_used >= p.max_claims
      )
        throw new ApiError(
          409,
          "WARRANTY_UNAVAILABLE",
          "Warranty has not started, has expired, or its service allowance is exhausted.",
        );
      if (this.profile(centerId)?.role !== "service_center")
        invalid("Choose a registered service center.");
      const id = randomUUID();
      this.run(
        "INSERT INTO claims VALUES(?,?,?,?,?,'submitted',NULL,NULL,?,NULL)",
        id,
        p.id,
        actor,
        centerId,
        text(description, 2000, "Description"),
        this.now(),
      );
      return this.get<Claim>("SELECT * FROM claims WHERE id=?", id)!;
    });
  }
  claimAction(
    actor: string,
    id: string,
    action: "approve" | "reject" | "complete",
    reason?: string,
    resolution?: string,
  ) {
    requireDatabaseMode();
    return this.transaction(() => {
      const c = this.get<Claim>("SELECT * FROM claims WHERE id=?", id);
      if (!c) throw new ApiError(404, "NOT_FOUND", "Claim not found.");
      if (!["approve", "reject", "complete"].includes(action))
        invalid("Invalid claim action.");
      if (
        c.service_center_id !== actor ||
        this.profile(actor)?.role !== "service_center"
      )
        forbidden("Only the assigned service center can manage this claim.");
      const status = {
        approve: "approved",
        reject: "rejected",
        complete: "completed",
      }[action];
      if (
        c.status === status ||
        (action === "approve" && c.status === "completed")
      )
        return c;
      if (
        (action === "complete" && c.status !== "approved") ||
        (action !== "complete" && c.status !== "submitted")
      )
        conflict("This action does not match the current claim state.");
      const now = this.now();
      if (action === "reject") reason = text(reason, 2000, "Rejection reason");
      if (action === "complete") {
        resolution = text(resolution, 2000, "Repair description");
        const p = this.requireProduct(c.product_id);
        if (p.claims_used >= p.max_claims)
          conflict("All warranty claims have already been used.");
        this.run(
          "UPDATE products SET claims_used=claims_used+1 WHERE id=?",
          p.id,
        );
        this.run(
          "INSERT INTO service_records VALUES(?,?,?,?,?,?)",
          randomUUID(),
          p.id,
          c.id,
          actor,
          resolution,
          now,
        );
      }
      this.run(
        "UPDATE claims SET status=?,decision_reason=?,resolution=?,resolved_at=? WHERE id=?",
        status,
        action === "reject" ? reason! : c.decision_reason,
        action === "complete" ? resolution! : c.resolution,
        action === "approve" ? c.resolved_at : now,
        id,
      );
      return this.get<Claim>("SELECT * FROM claims WHERE id=?", id)!;
    });
  }
  ownedProducts(actor: string) {
    return this.all<Product>(
      `SELECT ${productColumns} FROM products WHERE owner_id=? ORDER BY created_at DESC,rowid DESC`,
      actor,
    );
  }
  transfers(actor: string, productId?: string) {
    return this.all<Transfer>(
      `SELECT t.*,p.model,p.serial_number FROM transfers t JOIN products p ON p.id=t.product_id WHERE (t.from_user_id=? OR t.to_user_id=?) ${productId ? "AND t.product_id=?" : ""} ORDER BY t.created_at DESC,t.rowid DESC`,
      actor,
      actor,
      ...(productId ? [productId] : []),
    );
  }
  claims(actor: string, productId?: string) {
    return this.all<Claim>(
      `SELECT c.*,p.model,p.serial_number,coalesce(s.organization_name,s.display_name) AS service_center_name,u.wallet_address AS customer_wallet FROM claims c JOIN products p ON p.id=c.product_id JOIN profiles s ON s.id=c.service_center_id JOIN profiles u ON u.id=c.customer_id WHERE (c.customer_id=? OR c.service_center_id=?) ${productId ? "AND c.product_id=?" : ""} ORDER BY c.created_at DESC,c.rowid DESC`,
      actor,
      actor,
      ...(productId ? [productId] : []),
    );
  }
  dashboard(actor: string) {
    return {
      products: this.ownedProducts(actor),
      transfers: this.transfers(actor),
      claims: this.claims(actor),
    };
  }
  serviceCenters() {
    return this.all<{
      id: string;
      organization_name: string;
      wallet_address: string;
    }>(
      "SELECT id,organization_name,wallet_address FROM profiles WHERE role='service_center' ORDER BY organization_name",
    );
  }
  detail(actor: string, id: string): ProductDetail {
    // One consistent snapshot for ownership and private service visibility.
    return this.transaction(() => {
      const p = this.requireProduct(id),
        transfers = this.transfers(actor, id),
        claims = this.claims(actor, id);
      if (
        p.owner_id !== actor &&
        p.manufacturer_id !== actor &&
        !transfers.length &&
        !claims.length
      )
        throw new ApiError(404, "NOT_FOUND", "Product not found.");
      const services = this.all<ServiceRecord>(
        "SELECT s.* FROM service_records s JOIN claims c ON c.id=s.claim_id JOIN products p ON p.id=s.product_id WHERE s.product_id=? AND (p.owner_id=? OR c.customer_id=? OR c.service_center_id=?) ORDER BY s.created_at DESC,s.rowid DESC",
        id,
        actor,
        actor,
        actor,
      );
      return {
        product: p,
        transfers,
        claims,
        services,
        history: this.all<OwnershipEvent>(
          "SELECT * FROM ownership_events WHERE product_id=? ORDER BY created_at,rowid",
          id,
        ),
      };
    });
  }
  catalog(query: string, requestedPage: number) {
    const perPage = 12;
    const filter = `WHERE instr(lower(model), lower(?)) > 0
      OR instr(lower(serial_number), lower(?)) > 0`;
    const total = this.get<{ count: number }>(
      `SELECT count(*) AS count FROM products ${filter}`,
      query,
      query,
    )!.count;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.max(1, Math.min(requestedPage, pages));
    const products = this.all<CatalogProduct>(
      `SELECT id, serial_number, model, manufacturer_name, image_path,
        warranty_started_at, warranty_expires_at, claims_used, max_claims
        FROM products ${filter} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      query,
      query,
      perPage,
      (page - 1) * perPage,
    );
    return { products, page, pages, total };
  }
  publicProduct(query: string): PublicProductDetail {
    return this.transaction(() => {
      const p =
        this.product(query) ??
        this.get<Product>(
          `SELECT ${productColumns} FROM products WHERE serial_key=?`,
          query.trim().toLowerCase(),
        );
      if (!p)
        throw new ApiError(
          404,
          "NOT_FOUND",
          "No registered product matches this ID or serial number.",
        );
      const mask = (wallet: string) =>
        `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
      return {
        id: p.id,
        serial_number: p.serial_number,
        model: p.model,
        manufacturer_name: p.manufacturer_name,
        owner_display: mask(p.owner_wallet),
        created_at: p.created_at,
        image_path: p.image_path,
        warranty_duration_days: p.warranty_duration_days,
        warranty_started_at: p.warranty_started_at,
        warranty_expires_at: p.warranty_expires_at,
        max_claims: p.max_claims,
        claims_used: p.claims_used,
        history: this.all<OwnershipEvent>(
          "SELECT * FROM ownership_events WHERE product_id=? ORDER BY created_at,rowid",
          p.id,
        ).map((e) => ({
          id: e.id,
          from_display: e.from_wallet ? mask(e.from_wallet) : null,
          to_display: mask(e.to_wallet),
          kind: e.kind,
          created_at: e.created_at,
        })),
      };
    });
  }
  replaceImage(
    actor: string,
    id: string,
    previous: string | null,
    next: string,
  ) {
    return (
      this.run(
        "UPDATE products SET image_path=? WHERE id=? AND manufacturer_id=? AND image_path IS ?",
        next,
        id,
        actor,
        previous,
      ).changes === 1
    );
  }
}

const globalStore = globalThis as typeof globalThis & {
  dappDatabases?: Map<string, LocalDatabase>;
};
export function getDatabase(): LocalDatabase {
  // Runtime data must never be traced into the application build artifacts.
  const path = resolve(
    /* turbopackIgnore: true */ chainEnabled()
      ? chainManifest().databasePath
      : process.env.LOCAL_DATABASE_PATH || "data/dapp.sqlite",
  );
  const databases = (globalStore.dappDatabases ??= new Map<
    string,
    LocalDatabase
  >());
  let db = databases.get(path);
  if (!db) {
    db = new LocalDatabase(path);
    databases.set(path, db);
  }
  return db;
}
