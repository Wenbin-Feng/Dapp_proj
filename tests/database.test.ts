import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
import { LocalDatabase } from "../src/lib/database";
import type { Role } from "../src/lib/types";
let db: LocalDatabase, now: number;
const roles: Role[] = [
  "manufacturer",
  "retailer",
  "customer",
  "customer",
  "service_center",
  "service_center",
];
const ids = roles.map(() => randomUUID()),
  wallets = roles.map((_, i) => `0x${String(i + 1).repeat(40)}`);
beforeEach(() => {
  now = Date.now();
  db = new LocalDatabase(":memory:", () => now);
  roles.forEach((role, i) => {
    db.run("INSERT INTO accounts VALUES(?,?)", ids[i], wallets[i]);
    db.onboard(ids[i], wallets[i], {
      role,
      display_name: `Test ${i}`,
      organization_name: role === "customer" ? null : `Org ${i}`,
    });
  });
});
afterEach(() => db.close());
const product = (serial = "CASE-001", max = 2) =>
  db.register(ids[0], {
    serial_number: serial,
    model: "Watch",
    warranty_duration_days: 365,
    max_claims: max,
  });
const offer = (id: string, from: number, to: number) =>
  db.requestTransfer(ids[from], id, wallets[to]);
function transfer(id: string, from: number, to: number) {
  const t = offer(id, from, to);
  db.transferAction(ids[to], t.id, "accept");
  return t;
}
function sold(max = 2) {
  const p = product("CASE-001", max);
  transfer(p.id, 0, 1);
  expect(db.product(p.id)!.warranty_started_at).toBeNull();
  transfer(p.id, 1, 2);
  return db.product(p.id)!;
}
it("enforces product roles, limits, trim and case-insensitive Unicode serial uniqueness", () => {
  expect(() =>
    db.register(ids[2], {
      serial_number: "A",
      model: "B",
      warranty_duration_days: 365,
      max_claims: 1,
    }),
  ).toThrow("manufacturers");
  const p = product(" ÅBC-001 ");
  expect(p.serial_number).toBe("ÅBC-001");
  expect(() => product("åbc-001")).toThrow("already exists");
  expect(() =>
    db.register(ids[0], {
      serial_number: "X",
      model: "B",
      warranty_duration_days: 0,
      max_claims: 1,
    }),
  ).toThrow("terms");
  expect(db.publicProduct("åbc-001").id).toBe(p.id);
});
it("keeps role/wallet fixed at repeat onboarding and profile edits", () => {
  expect(
    db.onboard(ids[2], wallets[2], {
      role: "manufacturer",
      display_name: "Fake",
      organization_name: "Fake",
    }).role,
  ).toBe("customer");
  expect(() =>
    db.onboard(ids[2], wallets[0], { role: "customer", display_name: "Fake" }),
  ).toThrow("binding");
  expect(db.updateProfile(ids[2], "Updated", null).wallet_address).toBe(
    wallets[2],
  );
  expect(() => db.updateProfile(ids[0], "Maker", null)).toThrow("Organization");
});
it("requires current owner, registered receiver and the proper transfer role", () => {
  const p = product();
  expect(() => offer(p.id, 2, 3)).toThrow("current owner");
  expect(() => offer(p.id, 0, 2)).toThrow("Transfers follow");
  expect(() => offer(p.id, 0, 0)).toThrow("different recipient");
  expect(() => db.requestTransfer(ids[0], p.id, "0x" + "9".repeat(40))).toThrow(
    "complete their profile",
  );
});
it("does not transfer until acceptance; supports immutable retry, cancellation and rejection", () => {
  const p = product(),
    t = offer(p.id, 0, 1);
  expect(offer(p.id, 0, 1).id).toBe(t.id);
  expect(db.product(p.id)!.owner_id).toBe(ids[0]);
  expect(() => db.transferAction(ids[0], t.id, "accept")).toThrow(
    "cannot perform",
  );
  db.transferAction(ids[0], t.id, "cancel");
  db.transferAction(ids[0], t.id, "cancel");
  expect(() => db.transferAction(ids[1], t.id, "accept")).toThrow("resolved");
  const r = offer(p.id, 0, 1);
  db.transferAction(ids[1], r.id, "reject");
  expect(db.detail(ids[0], p.id).history).toHaveLength(1);
  const a = transfer(p.id, 0, 1);
  db.transferAction(ids[1], a.id, "accept");
  expect(db.detail(ids[0], p.id).history).toHaveLength(2);
});
it("starts warranty only at first accepted retail sale and preserves it on resale", () => {
  const p = sold();
  expect(p.warranty_started_at).toBe(new Date(now).toISOString());
  expect(Date.parse(p.warranty_expires_at!) - now).toBe(365 * 86400000);
  transfer(p.id, 2, 3);
  const d = db.detail(ids[3], p.id);
  expect(d.history).toHaveLength(4);
  expect(d.product.warranty_expires_at).toBe(p.warranty_expires_at);
  expect(() => offer(p.id, 2, 3)).toThrow("current owner");
  expect(() => db.submitClaim(ids[2], p.id, ids[4], "Old owner")).toThrow(
    "current customer",
  );
});
it("excludes pending transfers and open claims and restricts the assigned center", () => {
  const p = sold(),
    t = offer(p.id, 2, 3);
  expect(() => db.submitClaim(ids[2], p.id, ids[4], "X")).toThrow(
    "pending transfer",
  );
  db.transferAction(ids[2], t.id, "cancel");
  expect(() => db.submitClaim(ids[2], p.id, ids[1], "X")).toThrow(
    "service center",
  );
  const c = db.submitClaim(ids[2], p.id, ids[4], "X");
  expect(() => offer(p.id, 2, 3)).toThrow("open warranty");
  expect(() => db.submitClaim(ids[2], p.id, ids[4], "Again")).toThrow(
    "already open",
  );
  expect(() => db.claimAction(ids[5], c.id, "approve")).toThrow("assigned");
});
it("rejects with a reason without consuming entitlement", () => {
  const p = sold(),
    c = db.submitClaim(ids[2], p.id, ids[4], "X");
  expect(() => db.claimAction(ids[4], c.id, "reject")).toThrow("reason");
  db.claimAction(ids[4], c.id, "reject", "Not covered");
  db.claimAction(ids[4], c.id, "reject", "Overwrite");
  expect(db.claims(ids[2])[0].decision_reason).toBe("Not covered");
  expect(db.product(p.id)!.claims_used).toBe(0);
});
it("completes an admitted repair after expiry exactly once", () => {
  const p = sold(),
    c = db.submitClaim(ids[2], p.id, ids[4], "X");
  expect(() =>
    db.claimAction(ids[4], c.id, "complete", undefined, "Too soon"),
  ).toThrow("state");
  db.claimAction(ids[4], c.id, "approve");
  expect(db.product(p.id)!.claims_used).toBe(0);
  expect(() => db.claimAction(ids[4], c.id, "complete")).toThrow("Repair");
  now = Date.parse(p.warranty_expires_at!);
  db.claimAction(ids[4], c.id, "complete", undefined, "Battery replaced");
  db.claimAction(ids[4], c.id, "complete", undefined, "Overwrite");
  const d = db.detail(ids[2], p.id);
  expect(d.product.claims_used).toBe(1);
  expect(d.services).toHaveLength(1);
  expect(d.services[0].description).toBe("Battery replaced");
  expect(() => db.submitClaim(ids[2], p.id, ids[4], "Expired")).toThrow(
    "expired",
  );
});
it("blocks new requests at the exact expiry instant and after exhaustion", () => {
  const p = sold(1);
  now = Date.parse(p.warranty_expires_at!);
  expect(() => db.submitClaim(ids[2], p.id, ids[4], "Expired")).toThrow(
    "expired",
  );
  now -= 1;
  const c = db.submitClaim(ids[2], p.id, ids[4], "Last valid moment");
  db.claimAction(ids[4], c.id, "approve");
  db.claimAction(ids[4], c.id, "complete", undefined, "Done");
  expect(() => db.submitClaim(ids[2], p.id, ids[4], "Used")).toThrow(
    "exhausted",
  );
  transfer(p.id, 2, 3);
  expect(() => db.submitClaim(ids[3], p.id, ids[4], "Resold")).toThrow(
    "exhausted",
  );
});
it("keeps new-owner repair text private from previous owners, manufacturer and other centers", () => {
  const p = sold();
  expect(() => db.detail(ids[3], p.id)).toThrow("not found");
  const first = db.submitClaim(ids[2], p.id, ids[4], "First private");
  db.claimAction(ids[4], first.id, "approve");
  db.claimAction(ids[4], first.id, "complete", undefined, "First repair");
  transfer(p.id, 2, 3);
  const second = db.submitClaim(ids[3], p.id, ids[5], "Second private");
  db.claimAction(ids[5], second.id, "approve");
  db.claimAction(ids[5], second.id, "complete", undefined, "Second repair");
  expect(db.detail(ids[3], p.id).services).toHaveLength(2);
  expect(db.detail(ids[2], p.id).services.map((s) => s.description)).toEqual([
    "First repair",
  ]);
  expect(db.detail(ids[4], p.id).services.map((s) => s.description)).toEqual([
    "First repair",
  ]);
  expect(db.detail(ids[0], p.id).services).toHaveLength(0);
  expect(db.detail(ids[1], p.id).claims).toHaveLength(0);
});
it("public verification uses exact serial lookup and never includes full wallets or private IDs", () => {
  const p = product("A_%\\' OR 1=1");
  expect(db.publicProduct("a_%\\' or 1=1").id).toBe(p.id);
  expect(() => db.publicProduct("A_%")).toThrow("No registered");
  const value = db.publicProduct(p.id),
    serialized = JSON.stringify(value);
  for (const secret of [
    ...ids,
    ...wallets,
    '"claims":',
    '"services":',
    '"owner_id":',
  ])
    expect(serialized).not.toContain(secret);
});
it("rolls back the entire registration if its history event fails", () => {
  db.connection.exec(
    "CREATE TRIGGER fail_history BEFORE INSERT ON ownership_events BEGIN SELECT RAISE(ABORT,'test failure'); END;",
  );
  expect(() => product()).toThrow("test failure");
  expect(db.ownedProducts(ids[0])).toHaveLength(0);
});
it("uses compare-and-swap when two image replacements share the same old path", () => {
  const p = product();
  expect(db.replaceImage(ids[0], p.id, null, "first.webp")).toBe(true);
  expect(db.replaceImage(ids[0], p.id, null, "second.webp")).toBe(false);
  expect(db.product(p.id)!.image_path).toBe("first.webp");
});
it("preserves SQLite data after reopening and initializes the schema idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "dapp-sqlite-test-")),
    path = join(dir, "test.sqlite");
  try {
    const a = new LocalDatabase(path);
    a.run("INSERT INTO accounts VALUES(?,?)", ids[0], wallets[0]);
    a.close();
    const b = new LocalDatabase(path);
    expect(b.get("SELECT * FROM accounts WHERE id=?", ids[0])).toBeTruthy();
    b.close();
  } finally {
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(path + suffix, { force: true });
    rmdirSync(dir);
  }
});
