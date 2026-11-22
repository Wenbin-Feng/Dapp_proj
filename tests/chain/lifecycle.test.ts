import { PATCH as updateProfile } from "../../src/app/api/me/route";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  ZeroHash,
  hexlify,
  randomBytes,
  keccak256,
  type HDNodeWallet,
} from "ethers";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
import { getDatabase, LocalDatabase } from "../../src/lib/database";
import { chainManifest } from "../../src/lib/chain-config";
import {
  syncChain,
  closeChainProviders,
  chainInterface,
  prepareTransaction,
  completeTransaction,
  chainStatus,
} from "../../src/lib/chain-server";
import { toChainId } from "../../src/lib/chain-projection";
import { POST as challenge } from "../../src/app/api/auth/challenge/route";
import { POST as verify } from "../../src/app/api/auth/verify/route";
import { POST as onboard } from "../../src/app/api/onboarding/route";
import { POST as prepare } from "../../src/app/api/chain/prepare/route";
import { POST as confirm } from "../../src/app/api/chain/confirm/route";
import { POST as legacyRegister } from "../../src/app/api/products/route";
import { GET as publicVerify } from "../../src/app/api/verify/route";
import { GET as receiptRoute } from "../../src/app/api/chain/transaction/route";
import type { PreparedTransaction } from "../../src/lib/chain-types";
import type { Profile, Product, Transfer, Claim } from "../../src/lib/types";
const origin = "http://localhost:3000",
  op = () => hexlify(randomBytes(32)),
  id = () => toChainId(randomUUID());
const provider = new JsonRpcProvider(process.env.CHAIN_RPC_URL, undefined, {
  cacheTimeout: -1,
  batchMaxCount: 1,
  pollingInterval: 50,
});
let db: LocalDatabase, contract: Contract;
type Actor = { wallet: HDNodeWallet; session: string; profile: Profile };
let maker: Actor,
  retail: Actor,
  customer: Actor,
  buyer: Actor,
  center: Actor,
  otherCenter: Actor;
let product: Product, claim: Claim, firstExpiry: string;
const gas: Record<string, string[]> = {};
function req(path: string, method = "GET", body?: unknown, session = "") {
  return new Request(origin + "/api/" + path, {
    method,
    headers: { origin, "content-type": "application/json", cookie: session },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const cookie = (r: Response, name: string) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith(name + "="))
    ?.split(";")[0] || "";
async function login(role: number, granted = true): Promise<Actor> {
  const wallet = Wallet.createRandom().connect(provider);
  await provider.send("hardhat_setBalance", [
    wallet.address,
    "0x56BC75E2D63100000",
  ]);
  if (granted) await (await contract.grantRole(wallet.address, role)).wait();
  const c = await challenge(
    req("auth/challenge", "POST", {
      wallet_address: wallet.address,
      chain_id: 31337,
    }),
  );
  expect(c.status).toBe(200);
  const data = (await c.json()).data;
  const v = await verify(
    req(
      "auth/verify",
      "POST",
      { id: data.id, signature: await wallet.signMessage(data.message) },
      cookie(c, "dapp_challenge"),
    ),
  );
  expect(v.status).toBe(200);
  const session = cookie(v, "dapp_session");
  const o = await onboard(
    req(
      "onboarding",
      "POST",
      {
        role: [
          "none",
          "manufacturer",
          "retailer",
          "customer",
          "service_center",
        ][role],
        display_name: "Chain tester",
        organization_name: role === 3 ? null : "Chain Organization",
      },
      session,
    ),
  );
  expect(o.status).toBe(200);
  return { wallet, session, profile: (await o.json()).data };
}
async function prepared(actor: Actor, command: object) {
  const r = await prepare(req("chain/prepare", "POST", command, actor.session));
  const body = await r.json();
  expect(r.status, JSON.stringify(body)).toBe(200);
  return body.data as PreparedTransaction;
}
async function broadcast(actor: Actor, p: PreparedTransaction) {
  const tx = await actor.wallet.sendTransaction({ to: p.to, data: p.data });
  const r = (await tx.wait())!;
  (gas[p.kind] ??= []).push(r.gasUsed.toString());
  expect(r.status).toBe(1);
  return r.hash;
}
async function perform<T>(actor: Actor, command: object): Promise<T> {
  const p = await prepared(actor, command),
    hash = await broadcast(actor, p);
  const r = await confirm(
    req("chain/confirm", "POST", { id: p.id, hash }, actor.session),
  );
  const body = await r.json();
  expect(r.status, JSON.stringify(body)).toBe(200);
  return body.data.result;
}
async function transfer(from: Actor, to: Actor) {
  const t = await perform<Transfer>(from, {
    kind: "transfer",
    product_id: product.id,
    to_wallet: to.wallet.address,
  });
  return perform<Transfer>(to, {
    kind: "transferAction",
    id: t.id,
    action: "accept",
  });
}
beforeAll(async () => {
  db = getDatabase();
  contract = new Contract(
    chainManifest().address,
    chainInterface,
    await provider.getSigner(0),
  );
  maker = await login(1);
  retail = await login(2);
  customer = await login(3);
  buyer = await login(3);
  center = await login(4);
  otherCenter = await login(4);
});
afterAll(() => {
  writeFileSync(
    process.env.CHAIN_DEPLOYMENT_FILE!.replace(
      "deployment.json",
      "gas-results.json",
    ),
    JSON.stringify(gas, null, 2),
  );
  db?.close();
  closeChainProviders();
  provider.destroy();
});
it("self-enrolls a signed wallet while preserving contract role restrictions", async () => {
  const newcomer = await login(1, false);
  expect(await contract.roles(newcomer.wallet.address)).toBe(1n);
  expect(newcomer.profile.role).toBe("manufacturer");
  await expect(
    contract.connect(customer.wallet).getFunction("grantRole")(
      buyer.wallet.address,
      1,
    ),
  ).rejects.toThrow();
  await expect(contract.grantRole(maker.wallet.address, 3)).rejects.toThrow();
});
it("switches an existing session between all four workspaces and enforces the active contract role", async () => {
  const actor = await login(3, false);
  for (const [role, number] of [["manufacturer", 1], ["retailer", 2], ["service_center", 4], ["customer", 3]] as const) {
    const response = await updateProfile(req("me", "PATCH", {role, organization_name: "Role demo"}, actor.session));
    expect(response.status).toBe(200);
    expect((await response.json()).data.role).toBe(role);
    expect(await contract.roles(actor.wallet.address)).toBe(BigInt(number));
    const form = { kind: "register", serial_number: "ROLE-TEST", model: "Switch test", warranty_duration_days: 365, max_claims: 1 };
    const r = await prepare(req("chain/prepare", "POST", form, actor.session));
    expect(r.status === 200).toBe(role === "manufacturer");
  }
});
it("registers through a real signed transaction; receipt and SQLite agree", async () => {
  product = await perform<Product>(maker, {
    kind: "register",
    serial_number: "CHAIN-LIFECYCLE-001",
    model: "中文手表",
    warranty_duration_days: 2,
    max_claims: 2,
  });
  const p = await contract.getProduct(toChainId(product.id));
  expect(p.owner.toLowerCase()).toBe(maker.wallet.address.toLowerCase());
  expect(p.warrantyStarted).toBe(0n);
  expect(product.warranty_started_at).toBeNull();
  expect(p.serial).toBe(product.serial_number);
  const row = db.get<{ transaction_hash: string }>(
    "SELECT transaction_hash FROM chain_transactions WHERE product_id=?",
    product.id,
  )!;
  const receipt = await receiptRoute(
    req("chain/transaction?hash=" + row.transaction_hash),
  );
  expect(receipt.status).toBe(200);
  expect((await receipt.json()).data.events).toContain("ProductRegistered");
});
it("blocks legacy SQL mutations and rejects unauthorized manufacture and duplicate serials", async () => {
  const body = {
    serial_number: "SQL-BYPASS",
    model: "x",
    warranty_duration_days: 1,
    max_claims: 1,
  };
  expect(
    (await legacyRegister(req("products", "POST", body, maker.session))).status,
  ).toBe(409);
  await expect(
    contract.connect(customer.wallet).getFunction("registerProduct")(
      op(),
      id(),
      "FORGED",
      "x",
      "x",
      1,
      1,
    ),
  ).rejects.toThrow();
  await expect(
    contract.connect(maker.wallet).getFunction("registerProduct")(
      op(),
      id(),
      "chain-lifecycle-001",
      "x",
      "x",
      1,
      1,
    ),
  ).rejects.toThrow();
});
it("rejects invalid IDs, warranty limits and noncanonical serials at contract level", async () => {
  const c = contract.connect(maker.wallet).getFunction("registerProduct");
  for (const args of [
    ["0x" + "00".repeat(16), "BADID", "m", "o", 1, 1],
    [id(), "with space", "m", "o", 1, 1],
    [id(), "ZERO", "m", "o", 0, 1],
    [id(), "LIMIT", "m", "o", 1, 1001],
  ])
    await expect(c(op(), ...args)).rejects.toThrow();
});
it("enforces transfer direction, current owner, pending mutex and participant decisions", async () => {
  const p = toChainId(product.id);
  await expect(
    contract.connect(maker.wallet).getFunction("requestTransfer")(
      op(),
      id(),
      p,
      customer.wallet.address,
    ),
  ).rejects.toThrow();
  const t = await perform<Transfer>(maker, {
    kind: "transfer",
    product_id: product.id,
    to_wallet: retail.wallet.address,
  });
  await expect(
    contract.connect(maker.wallet).getFunction("requestTransfer")(
      op(),
      id(),
      p,
      retail.wallet.address,
    ),
  ).rejects.toThrow();
  await expect(
    contract.connect(customer.wallet).getFunction("resolveTransfer")(
      op(),
      toChainId(t.id),
      1,
    ),
  ).rejects.toThrow();
  await perform(retail, { kind: "transferAction", id: t.id, action: "reject" });
  const cancel = await perform<Transfer>(maker, {
    kind: "transfer",
    product_id: product.id,
    to_wallet: retail.wallet.address,
  });
  await perform(maker, {
    kind: "transferAction",
    id: cancel.id,
    action: "cancel",
  });
  expect(db.product(product.id)!.owner_id).toBe(maker.profile.id);
});
it("rejects malformed UTF-8 and oversized direct-call metadata that would break the SQLite projection", async () => {
  const fn = contract.connect(maker.wallet).getFunction("registerProduct");
  for (const model of ["x".repeat(121), "   ", "has\u0000null"])
    await expect(
      fn(op(), id(), "BAD-METADATA", model, "Organization", 1, 1),
    ).rejects.toThrow();
  const data = chainInterface.encodeFunctionData("registerProduct", [
    op(),
    id(),
    "BAD-UTF8",
    "UTF8_SENTINEL",
    "Organization",
    1,
    1,
  ]);
  const invalid = data.replace(
    Buffer.from("UTF8_SENTINEL").toString("hex"),
    "ff" + Buffer.from("TF8_SENTINEL").toString("hex"),
  );
  await expect(
    maker.wallet.call({ to: chainManifest().address, data: invalid }),
  ).rejects.toThrow();
  await syncChain(db);
  expect(
    db.get("SELECT * FROM products WHERE serial_number='BAD-UTF8'"),
  ).toBeUndefined();
});
it("binds operation IDs to each actor so another manufacturer cannot consume a victim's ID", async () => {
  const another = Wallet.createRandom().connect(provider);
  await provider.send("hardhat_setBalance", [
    another.address,
    "0x56BC75E2D63100000",
  ]);
  await (await contract.grantRole(another.address, 1)).wait();
  const shared = op();
  await (
    await contract.connect(another).getFunction("registerProduct")(
      shared,
      id(),
      "OTHER-OP",
      "Other",
      "Organization",
      1,
      1,
    )
  ).wait();
  await (
    await contract.connect(maker.wallet).getFunction("registerProduct")(
      shared,
      id(),
      "MAKER-OP",
      "Maker",
      "Organization",
      1,
      1,
    )
  ).wait();
  await syncChain(db);
  expect(
    db.all("SELECT * FROM chain_operations WHERE operation_id=?", shared),
  ).toHaveLength(2);
});
it("starts warranty only on the first retail-to-customer acceptance", async () => {
  await transfer(maker, retail);
  expect(db.product(product.id)!.warranty_started_at).toBeNull();
  await transfer(retail, customer);
  product = db.product(product.id)!;
  firstExpiry = product.warranty_expires_at!;
  expect(
    Date.parse(firstExpiry) - Date.parse(product.warranty_started_at!),
  ).toBe(2 * 86400000);
  expect(
    (await contract.getProduct(toChainId(product.id))).warrantyExpires,
  ).toBe(BigInt(Date.parse(firstExpiry) / 1000));
});
it("rejects forged receipts and another user's intent without changing ownership", async () => {
  const p = await prepared(customer, {
    kind: "transfer",
    product_id: product.id,
    to_wallet: buyer.wallet.address,
  });
  const foreign = await buyer.wallet.sendTransaction({
    to: maker.wallet.address,
    value: 1n,
  });
  await foreign.wait();
  expect(
    (
      await confirm(
        req(
          "chain/confirm",
          "POST",
          { id: p.id, hash: foreign.hash },
          customer.session,
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (await confirm(req("chain/confirm", "POST", { id: p.id }, buyer.session)))
      .status,
  ).toBe(404);
  expect(db.product(product.id)!.owner_id).toBe(customer.profile.id);
});
it("recovers a broadcast transaction without its hash or confirmation callback, exactly once", async () => {
  const p = await prepared(customer, {
    kind: "transfer",
    product_id: product.id,
    to_wallet: buyer.wallet.address,
  });
  await broadcast(customer, p);
  const a = await completeTransaction(db, customer.profile.id, p.id);
  const b = await completeTransaction(db, customer.profile.id, p.id);
  expect(a.transaction_hash).toBe(b.transaction_hash);
  await perform(buyer, {
    kind: "transferAction",
    id: p.entityId,
    action: "accept",
  });
  expect(db.product(product.id)!.warranty_expires_at).toBe(firstExpiry);
  const before = db.all(
    "SELECT * FROM ownership_events WHERE product_id=?",
    product.id,
  ).length;
  await Promise.all([syncChain(db), syncChain(db), syncChain(db)]);
  expect(
    db.all("SELECT * FROM ownership_events WHERE product_id=?", product.id),
  ).toHaveLength(before);
  await expect(
    contract.connect(customer.wallet).getFunction("requestTransfer")(
      p.id,
      toChainId(p.entityId),
      toChainId(product.id),
      buyer.wallet.address,
    ),
  ).rejects.toThrow();
});
it("commits private repair text without putting plaintext on-chain or in public verification", async () => {
  const description = "Private customer phone 13800000000; battery failure";
  const p = await prepared(buyer, {
    kind: "claim",
    product_id: product.id,
    service_center_id: center.profile.id,
    description,
  });
  expect(p.data.toLowerCase()).not.toContain(
    Buffer.from(description).toString("hex"),
  );
  await broadcast(buyer, p);
  const result = await completeTransaction(db, buyer.profile.id, p.id);
  claim = result.result as Claim;
  expect(claim.description).toBe(description);
  const response = await publicVerify(
    req("verify?query=" + product.serial_number),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain(description);
  expect(text).not.toContain(center.profile.id);
  expect(text).toContain("transaction_hash");
});
it("locks transfer while claim is open and only assigned service center can decide", async () => {
  await expect(
    contract.connect(buyer.wallet).getFunction("requestTransfer")(
      op(),
      id(),
      toChainId(product.id),
      customer.wallet.address,
    ),
  ).rejects.toThrow();
  await expect(
    contract.connect(otherCenter.wallet).getFunction("resolveClaim")(
      op(),
      toChainId(claim.id),
      1,
      ZeroHash,
    ),
  ).rejects.toThrow();
  await expect(
    contract.connect(center.wallet).getFunction("resolveClaim")(
      op(),
      toChainId(claim.id),
      3,
      op(),
    ),
  ).rejects.toThrow();
  await perform(center, {
    kind: "claimAction",
    id: claim.id,
    action: "reject",
    reason: "No covered fault found",
  });
  expect(db.product(product.id)!.claims_used).toBe(0);
});
it("approves then completes a repair, consumes one allowance and records the private resolution", async () => {
  claim = await perform<Claim>(buyer, {
    kind: "claim",
    product_id: product.id,
    service_center_id: center.profile.id,
    description: "Battery needs replacement",
  });
  await perform(center, {
    kind: "claimAction",
    id: claim.id,
    action: "approve",
  });
  await perform(center, {
    kind: "claimAction",
    id: claim.id,
    action: "complete",
    resolution: "Replaced battery, internal job 123",
  });
  expect(db.product(product.id)!.claims_used).toBe(1);
  expect((await contract.getProduct(toChainId(product.id))).claimsUsed).toBe(
    1n,
  );
  expect(
    db.all("SELECT * FROM service_records WHERE claim_id=?", claim.id),
  ).toHaveLength(1);
  await expect(
    contract.connect(center.wallet).getFunction("resolveClaim")(
      op(),
      toChainId(claim.id),
      3,
      op(),
    ),
  ).rejects.toThrow();
});
it("consumes final allowance once and rejects further claims", async () => {
  const c = await perform<Claim>(buyer, {
    kind: "claim",
    product_id: product.id,
    service_center_id: center.profile.id,
    description: "Second covered fault",
  });
  await perform(center, { kind: "claimAction", id: c.id, action: "approve" });
  await perform(center, {
    kind: "claimAction",
    id: c.id,
    action: "complete",
    resolution: "Repaired",
  });
  expect(db.product(product.id)!.claims_used).toBe(2);
  await expect(
    contract.connect(buyer.wallet).getFunction("submitClaim")(
      op(),
      id(),
      toChainId(product.id),
      center.wallet.address,
      op(),
    ),
  ).rejects.toThrow();
});
it("indexes direct contract callers and recovers a fresh SQLite projection from events", async () => {
  const direct = Wallet.createRandom().connect(provider);
  await provider.send("hardhat_setBalance", [
    direct.address,
    "0x56BC75E2D63100000",
  ]);
  await (await contract.grantRole(direct.address, 1)).wait();
  const pid = id();
  await (
    await contract.connect(direct).getFunction("registerProduct")(
      op(),
      pid,
      "DIRECT-CALL",
      "Direct model",
      "Direct org",
      5,
      1,
    )
  ).wait();
  await syncChain(db);
  expect(
    db.get("SELECT * FROM products WHERE serial_number='DIRECT-CALL'"),
  ).toBeDefined();
  const fresh = new LocalDatabase(":memory:");
  try {
    await syncChain(fresh);
    expect(fresh.product(product.id)!.claims_used).toBe(2);
    expect(fresh.product(product.id)!.owner_wallet).toBe(
      buyer.wallet.address.toLowerCase(),
    );
    expect(fresh.all("SELECT * FROM service_records")).toHaveLength(2);
    expect(
      fresh
        .all("SELECT description FROM claims")
        .every((row) => JSON.stringify(row).includes("unavailable")),
    ).toBe(true);
  } finally {
    fresh.close();
  }
});
it("rejects new claims at exact expiry but permits completion of an already admitted repair", async () => {
  const original = product;
  product = await perform<Product>(maker, {
    kind: "register",
    serial_number: "EXPIRY",
    model: "Short warranty",
    warranty_duration_days: 1,
    max_claims: 3,
  });
  await transfer(maker, retail);
  await transfer(retail, customer);
  const c = await perform<Claim>(customer, {
    kind: "claim",
    product_id: product.id,
    service_center_id: center.profile.id,
    description: "Reported before expiry",
  });
  const expires = Number(
    (await contract.getProduct(toChainId(product.id))).warrantyExpires,
  );
  await provider.send("evm_setNextBlockTimestamp", [expires]);
  await provider.send("evm_mine", []);
  await perform(center, { kind: "claimAction", id: c.id, action: "approve" });
  await perform(center, {
    kind: "claimAction",
    id: c.id,
    action: "complete",
    resolution: "Completed after warranty expired",
  });
  await expect(
    contract.connect(customer.wallet).getFunction("submitClaim")(
      op(),
      id(),
      toChainId(product.id),
      center.wallet.address,
      op(),
    ),
  ).rejects.toThrow();
  product = original;
});
it("uses a strict block-timestamp expiry boundary for new claims", async () => {
  const original = product;
  product = await perform<Product>(maker, {
    kind: "register",
    serial_number: "EXACT-EXPIRY",
    model: "Boundary",
    warranty_duration_days: 1,
    max_claims: 1,
  });
  await transfer(maker, retail);
  await transfer(retail, customer);
  const expiry = Number(
      (await contract.getProduct(toChainId(product.id))).warrantyExpires,
    ),
    fn = contract.connect(customer.wallet).getFunction("submitClaim");
  const args = [op(), id(), toChainId(product.id), center.wallet.address, op()];
  await provider.send("evm_setNextBlockTimestamp", [expiry - 1]);
  await provider.send("evm_mine", []);
  await expect(fn.staticCall(...args)).resolves.toBeDefined();
  await provider.send("evm_setNextBlockTimestamp", [expiry]);
  await provider.send("evm_mine", []);
  await expect(fn.staticCall(...args)).rejects.toThrow();
  product = original;
});
it("fails closed when the saved deployment changes", async () => {
  const file = process.env.CHAIN_DEPLOYMENT_FILE!,
    saved = readFileSync(file, "utf8");
  try {
    const d = JSON.parse(saved);
    d.deploymentId = op();
    writeFileSync(file, JSON.stringify(d));
    expect((await chainStatus(db)).ready).toBe(false);
    await expect(syncChain(db)).rejects.toMatchObject({
      code: "CHAIN_CHANGED",
    });
  } finally {
    writeFileSync(file, saved);
  }
});
it("detects an indexed chain reorganization instead of silently serving stale ownership", async () => {
  const snapshot = await provider.send("evm_snapshot", []);
  const p = await prepared(maker, {
    kind: "register",
    serial_number: "REORG",
    model: "Temporary fork",
    warranty_duration_days: 1,
    max_claims: 1,
  });
  await broadcast(maker, p);
  await syncChain(db);
  await provider.send("evm_revert", [snapshot]);
  await expect(syncChain(db)).rejects.toMatchObject({ code: "CHAIN_REORG" });
});
