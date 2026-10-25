// Explicit, manual live acceptance. Creates only new QA wallets and products.
// Never runs in CI; private test keys stay in ignored, mode-600 local files.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
if (!args.includes("--live")) throw new Error("Live writes require --live and an explicit --app-url.");
const appUrl = new URL(option("--app-url", ""));
if (appUrl.pathname !== "/" || appUrl.search || appUrl.hash || appUrl.username || appUrl.password)
  throw new Error("Use an application origin only.");
if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost") throw new Error("HTTPS is required.");
const APP = appUrl.origin;
if (option("--env-file")) process.loadEnvFile(resolve(option("--env-file")));
const run = option("--run", "2026-10-25");
if (!/^\d{4}-\d{2}-\d{2}(?:-[a-z0-9]+)?$/.test(run)) throw new Error("Invalid QA run name.");
const PREFIX = `QA-${run.replaceAll("-", "").toUpperCase()}`;
const directory = resolve("tmp/live-acceptance", run);
await mkdir(directory, { recursive: true, mode: 0o700 });
const privatePath = `${directory}/private.json`;
let journal;
try { journal = JSON.parse(await readFile(privatePath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; journal = { createdAt: new Date().toISOString(), actors: {} }; }
journal.products ||= {};
journal.checkpoints ||= {};
const save = () => writeFile(privatePath, JSON.stringify(journal, null, 2), { mode: 0o600 });
const results = [];
const actors = {};
const requestFetch = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
const definitions = {
  manufacturer: ["manufacturer", "QA Manufacturer", "QA PolyU Devices"],
  retailer: ["retailer", "QA Retailer", "QA Campus Store"],
  customerA: ["customer", "QA Customer Alice", null],
  customerB: ["customer", "QA Customer Bob", null],
  center: ["service_center", "QA Service Center", "QA Campus Repairs"],
  otherCenter: ["service_center", "QA Other Center", "QA Independent Repairs"],
};

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: "passed", milliseconds: Date.now() - started });
    console.log(`PASS ${name}`);
    return detail;
  } catch (error) {
    // All values here belong to these QA actors; never serialize auth clients,
    // sessions, response bodies, environment variables, or request headers.
    results.push({ name, status: "failed", error: error.message.slice(0, 700) });
    console.log(`FAIL ${name}: ${error.message.slice(0, 700)}`);
    throw error;
  } finally { await report(); }
}
async function checkpoint(name, fn) {
  if (Object.hasOwn(journal.checkpoints, name)) {
    results.push({ name, status: "previously-passed", note: "Resumed from this run's private journal." });
    return journal.checkpoints[name];
  }
  const value = await check(name, fn);
  journal.checkpoints[name] = value ?? null;
  await save();
  return value;
}
async function report() {
  const publicActors = Object.fromEntries(Object.entries(journal.actors).map(([name, actor]) => [name, { address: actor.address, role: definitions[name]?.[0] }]));
  await writeFile(`${directory}/report.json`, JSON.stringify({ app: APP, run, prefix: PREFIX, checkedAt: new Date().toISOString(), actors: publicActors, products: journal.products, results }, null, 2));
}
async function raw(actor, method, path, input, extraHeaders = {}) {
  const headers = { Origin: APP, ...extraHeaders };
  if (actor) headers.Cookie = [...actors[actor].jar].map(([name, value]) => `${name}=${value}`).join("; ");
  let body;
  if (input instanceof FormData) body = input;
  else if (input !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(input); }
  const response = await requestFetch(`${APP}${path}`, { method, headers, body });
  const payload = await response.json();
  return { status: response.status, payload };
}
async function api(actor, method, path, input, expected = 200) {
  const { status, payload } = await raw(actor, method, path, input);
  assert.equal(status, expected, `${method} ${path}: HTTP ${status}, ${payload.error?.code || "unexpected response"}: ${payload.error?.message || ""}`);
  return payload.data;
}
async function denied(actor, method, path, input, expected = [400, 403, 409], code) {
  const { status, payload } = await raw(actor, method, path, input);
  assert.ok(expected.includes(status), `${method} ${path}: expected rejection, received HTTP ${status}`);
  if (code) assert.equal(payload.error?.code, code);
}
async function authenticate(name) {
  if (!journal.actors[name]) {
    const privateKey = generatePrivateKey();
    journal.actors[name] = { privateKey, address: privateKeyToAccount(privateKey).address };
    await save();
  }
  const actor = journal.actors[name];
  const account = privateKeyToAccount(actor.privateKey);
  const jar = new Map();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: requestFetch },
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: items => items.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const wallet = { request: async ({ method, params }) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "personal_sign") return account.signMessage({ message: { raw: params[0] } });
    throw new Error("Unsupported QA wallet request.");
  } };
  const { data, error } = await client.auth.signInWithWeb3({ chain: "ethereum", wallet, statement: "QA test login for group project. No payment or transaction.", options: { url: `${APP}/login` } });
  if (error) throw new Error(`QA Web3 login failed: ${error.code || error.name}`);
  actors[name] = { jar, client, account };
  actor.userId = data.user.id;
  await save();
  const me = await api(name, "GET", "/api/me");
  assert.equal(me.wallet_address, account.address.toLowerCase());
  return me;
}
const productPath = product => `/api/products/${product.id}`;
async function register(label, model, max = 3) {
  const value = await checkpoint(`Register ${label}`, () => api("manufacturer", "POST", "/api/products", {
    serial_number: `${PREFIX}-${label}`, model: `QA ${model}`, warranty_duration_days: 365, max_claims: max,
  }, 201));
  journal.products[label] = { id: value.id, serial: value.serial_number, model: value.model, verify: `${APP}/verify?q=${encodeURIComponent(value.serial_number)}` };
  await save();
  return value;
}
const detail = (actor, product) => api(actor, "GET", productPath(product));
const transfer = (from, to, product) => api(from, "POST", `${productPath(product)}/transfers`, { to_wallet: journal.actors[to].address });
const transferAction = (actor, item, action) => api(actor, "POST", `/api/transfers/${item.id}/action`, { action });
const claim = (actor, product, text) => api(actor, "POST", "/api/claims", { product_id: product.id, service_center_id: journal.actors.center.userId, description: `QA PRIVATE ${text}` }, 201);
const claimAction = (item, action, extra = {}, actor = "center") => api(actor, "POST", `/api/claims/${item.id}/action`, { action, ...extra });
async function deliver(product, target = "customerA") {
  await checkpoint(`Deliver ${product.serial_number} to ${target}`, async () => {
    const inventory = await transfer("manufacturer", "retailer", product);
    await transferAction("retailer", inventory, "accept");
    assert.equal((await detail("retailer", product)).product.warranty_started_at, null);
    if (target === "retailer") return;
    const sale = await transfer("retailer", target, product);
    await transferAction(target, sale, "accept");
    const { product: accepted } = await detail(target, product);
    assert.ok(accepted.warranty_started_at && accepted.warranty_expires_at);
    assert.equal(accepted.owner_id, journal.actors[target].userId);
  });
}

try {
  const config = await check("Public chain configuration and database product mode", () => api(null, "GET", "/api/chain/config"));
  assert.equal(config.productBackend, "database", "This seed suite is for the database product backend.");
  await check("Anonymous authentication and same-origin protection", async () => {
    await denied(null, "GET", "/api/me", undefined, [401], "AUTH_REQUIRED");
    const result = await raw(null, "POST", "/api/onboarding", {}, { Origin: "https://example.invalid" });
    assert.equal(result.status, 403);
    assert.equal(result.payload.error.code, "INVALID_ORIGIN");
  });
  for (const [name, [role, display_name, organization_name]] of Object.entries(definitions)) {
    const me = await check(`Real signed Web3 login: ${name}`, () => authenticate(name));
    if (!me.profile) {
      await check(`First-login gate: ${name}`, () => denied(name, "GET", "/api/dashboard", undefined, [403], "ONBOARDING_REQUIRED"));
      await check(`Create ${role} profile: ${name}`, async () => {
        await denied(name, "POST", "/api/onboarding", { display_name: "", role, organization_name }, [400]);
        const profile = await api(name, "POST", "/api/onboarding", { display_name, role, organization_name });
        assert.equal(profile.role, role);
      });
    }
    await check(`Profile and fixed wallet binding: ${name}`, async () => {
      const profile = (await api(name, "GET", "/api/me")).profile;
      assert.equal(profile.role, role);
      const repeated = await api(name, "POST", "/api/onboarding", { display_name: "QA should not overwrite", role: role === "customer" ? "retailer" : "customer", organization_name: "QA should not overwrite" });
      assert.equal(repeated.id, profile.id);
      assert.equal(repeated.role, role);
      assert.equal(repeated.display_name, profile.display_name);
    });
  }
  await checkpoint("Profile update and invalid organization/role rejection", async () => {
    const updated = await api("manufacturer", "PATCH", "/api/me", { display_name: "QA Manufacturer Verified", organization_name: "QA PolyU Devices" });
    assert.equal(updated.display_name, "QA Manufacturer Verified");
    await denied("manufacturer", "PATCH", "/api/me", { organization_name: null }, [400]);
    await denied("manufacturer", "PATCH", "/api/me", { role: "customer" }, [400]);
  });
  const inventory = await register("INVENTORY", "Studio Headphones — Manufacturer stock");
  const retail = await register("RETAIL", "Campus Laptop — Retailer stock");
  const lifecycle = await register("RESALE", "Travel Camera — Resale and completed repairs", 2);
  await checkpoint("Registration validation, unique serial, and role protection", async () => {
    const input = { serial_number: inventory.serial_number.toLowerCase(), model: "QA Duplicate", warranty_duration_days: 365, max_claims: 3 };
    await denied("manufacturer", "POST", "/api/products", input, [409], "CONFLICT");
    await denied("customerA", "POST", "/api/products", { ...input, serial_number: `${PREFIX}-DENIED` }, [403]);
    await denied("manufacturer", "POST", "/api/products", { ...input, warranty_duration_days: 0 }, [400]);
    await denied("manufacturer", "GET", "/api/products/not-a-uuid", undefined, [400]);
    await denied("customerB", "GET", productPath(inventory), undefined, [404], "NOT_FOUND");
    await denied("manufacturer", "POST", `${productPath(inventory)}/transfers`, { to_wallet: journal.actors.customerA.address }, [400]);
    await denied("manufacturer", "POST", `${productPath(inventory)}/transfers`, { to_wallet: "0x0000000000000000000000000000000000000001" }, [400], "INVALID_INPUT");
  });
  await deliver(retail, "retailer");
  await deliver(lifecycle);
  await checkpoint("Transfer cancel, reject, pending deduplication, and unauthorized actions", async () => {
    const item = await transfer("manufacturer", "retailer", inventory);
    assert.equal((await transfer("manufacturer", "retailer", inventory)).id, item.id);
    await denied("customerB", "POST", `/api/transfers/${item.id}/action`, { action: "accept" }, [403]);
    await denied("manufacturer", "POST", `/api/transfers/${item.id}/action`, { action: "accept" }, [403]);
    assert.equal((await transferAction("manufacturer", item, "cancel")).status, "cancelled");
    assert.equal((await transferAction("manufacturer", item, "cancel")).status, "cancelled");
    const second = await transfer("manufacturer", "retailer", inventory);
    assert.equal((await transferAction("retailer", second, "reject")).status, "rejected");
    assert.equal((await detail("manufacturer", inventory)).product.warranty_started_at, null);
  });
  await checkpoint("Submitted claim excludes transfers; assigned-center authorization", async () => {
    const item = await claim("customerA", lifecycle, "Battery does not charge.");
    await denied("customerA", "POST", `${productPath(lifecycle)}/transfers`, { to_wallet: journal.actors.customerB.address }, [409]);
    await denied("customerA", "POST", "/api/claims", { product_id: lifecycle.id, service_center_id: journal.actors.center.userId, description: "QA duplicate claim" }, [409]);
    await denied("otherCenter", "POST", `/api/claims/${item.id}/action`, { action: "approve" }, [403]);
    await denied("center", "POST", `/api/claims/${item.id}/action`, { action: "complete", resolution: "QA too early" }, [409]);
    await claimAction(item, "approve");
    assert.equal((await detail("customerA", lifecycle)).product.claims_used, 0);
    await denied("center", "POST", `/api/claims/${item.id}/action`, { action: "complete" }, [400]);
    await claimAction(item, "complete", { resolution: "QA PRIVATE Battery replaced; charge cycle verified." });
    await claimAction(item, "complete", { resolution: "QA should not overwrite original repair." });
    const after = await detail("customerA", lifecycle);
    assert.equal(after.product.claims_used, 1);
    assert.equal(after.services.length, 1);
    assert.match(after.services[0].description, /Battery replaced/);
    const manufacturer = await detail("manufacturer", lifecycle);
    assert.equal(manufacturer.claims.length, 0);
    assert.equal(manufacturer.services.length, 0);
  });
  await checkpoint("Resale inherits warranty; pending transfer blocks new claims", async () => {
    const before = (await detail("customerA", lifecycle)).product;
    const item = await transfer("customerA", "customerB", lifecycle);
    await denied("customerA", "POST", "/api/claims", { product_id: lifecycle.id, service_center_id: journal.actors.center.userId, description: "QA during pending resale" }, [409]);
    await transferAction("customerB", item, "accept");
    await transferAction("customerB", item, "accept");
    const after = await detail("customerB", lifecycle);
    assert.equal(after.product.warranty_started_at, before.warranty_started_at);
    assert.equal(after.product.warranty_expires_at, before.warranty_expires_at);
    assert.equal(after.product.claims_used, 1);
    assert.equal(after.services.length, 1);
  });
  await checkpoint("New-owner private text is hidden from previous owner; allowance exhaustion", async () => {
    const item = await claim("customerB", lifecycle, "BOB PRIVATE Camera shutter is stuck.");
    const previous = await detail("customerA", lifecycle);
    assert.ok(previous.claims.every(entry => entry.id !== item.id));
    assert.ok(!JSON.stringify(previous).includes("BOB PRIVATE"));
    await claimAction(item, "approve");
    await claimAction(item, "complete", { resolution: "QA PRIVATE BOB Shutter module replaced." });
    assert.equal((await detail("customerB", lifecycle)).product.claims_used, 2);
    await denied("customerB", "POST", "/api/claims", { product_id: lifecycle.id, service_center_id: journal.actors.center.userId, description: "QA exhausted" }, [409], "WARRANTY_UNAVAILABLE");
  });
  const pending = await register("PENDING", "Smart Speaker — Awaiting customer acceptance");
  await deliver(pending, "retailer");
  await checkpoint("Leave a pending retail delivery for demonstration", () => transfer("retailer", "customerA", pending));
  for (const [label, model, state] of [
    ["SUBMITTED", "Smartwatch — Service requested", "submitted"],
    ["APPROVED", "Tablet — Repair approved", "approved"],
    ["REJECTED", "Wireless Mouse — Rejected service, allowance preserved", "rejected"],
  ]) {
    const product = await register(label, model);
    await deliver(product);
    await checkpoint(`Leave ${state} warranty example`, async () => {
      const item = await claim("customerA", product, `${model}: demonstration request.`);
      if (state === "approved") await claimAction(item, "approve");
      if (state === "rejected") {
        await denied("center", "POST", `/api/claims/${item.id}/action`, { action: "reject" }, [400]);
        await claimAction(item, "reject", { reason: "QA PRIVATE Cosmetic damage is outside this warranty." });
      }
      assert.equal((await detail("customerA", product)).product.claims_used, 0);
    });
  }
  if (args.includes("--expiry-fixtures")) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: requestFetch } });
    for (const admitted of [false, true]) {
      const product = await register(admitted ? "EXPIRED-REPAIR" : "EXPIRED", admitted ? "Monitor — Admitted repair completed after expiry" : "Keyboard — Warranty expired");
      await deliver(product);
      await checkpoint(`Temporal QA fixture: ${admitted ? "admitted repair survives expiry" : "expired warranty rejects new claims"}`, async () => {
        const open = admitted ? await claim("customerA", product, "Valid request admitted before simulated expiry.") : null;
        const expires = new Date(Date.now() - 86400000);
        const started = new Date(expires.getTime() - 365 * 86400000);
        // Clock-boundary fixture only: exact new QA product, serial and maker.
        // Does not touch any pre-existing user's data or change business rules.
        const { data, error } = await admin.from("dapp_products").update({ warranty_started_at: started.toISOString(), warranty_expires_at: expires.toISOString() })
          .eq("id", product.id).eq("serial_number", product.serial_number).eq("manufacturer_id", journal.actors.manufacturer.userId).select("id").single();
        assert.ok(!error && data?.id === product.id, "Could not set the isolated QA expiry fixture.");
        if (open) { await claimAction(open, "approve"); await claimAction(open, "complete", { resolution: "QA PRIVATE Valid pre-expiry request completed after expiry." }); }
        await denied("customerA", "POST", "/api/claims", { product_id: product.id, service_center_id: journal.actors.center.userId, description: "QA too late" }, [409], "WARRANTY_UNAVAILABLE");
      });
    }
  }
  await check("Dashboard, transfer/claim lists, service center discovery and ownership filters", async () => {
    for (const name of Object.keys(definitions)) {
      const dashboard = await api(name, "GET", "/api/dashboard");
      const products = await api(name, "GET", "/api/products");
      const transfers = await api(name, "GET", "/api/transfers");
      const claims = await api(name, "GET", "/api/claims");
      assert.deepEqual(dashboard.products, products);
      assert.deepEqual(dashboard.transfers, transfers);
      assert.deepEqual(dashboard.claims, claims);
      assert.ok(products.every(item => item.owner_id === journal.actors[name].userId));
      assert.ok(transfers.every(item => [item.from_user_id, item.to_user_id].includes(journal.actors[name].userId)));
      assert.ok(claims.every(item => [item.customer_id, item.service_center_id].includes(journal.actors[name].userId)));
    }
    const centers = await api("customerA", "GET", "/api/service-centers");
    assert.ok(centers.some(item => item.id === journal.actors.center.userId));
  });
  await check("Anonymous verifier: serial/UUID lookup, masked history and private-text exclusion", async () => {
    for (const product of Object.values(journal.products)) {
      const data = await api(null, "GET", `/api/verify?query=${encodeURIComponent(product.serial.toLowerCase())}`);
      assert.equal(data.id, product.id);
      assert.equal((await api(null, "GET", `/api/verify?query=${product.id}`)).id, product.id);
      const text = JSON.stringify(data);
      assert.ok(!text.includes("PRIVATE"));
      for (const actor of Object.values(journal.actors)) {
        assert.ok(!text.toLowerCase().includes(actor.address.toLowerCase()));
        assert.ok(!text.includes(actor.userId));
      }
      for (const key of ["services", "claims", "owner_id", "manufacturer_id"]) assert.ok(!Object.hasOwn(data, key));
    }
    await denied(null, "GET", "/api/verify?query=%25", undefined, [404]);
    await denied(null, "GET", `/api/verify?query=${PREFIX}-MISSING`, undefined, [404]);
  });
  await check("Cloud table and RPC permissions reject direct client access", async () => {
    const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: requestFetch } });
    for (const client of [anonymous, actors.customerA.client]) {
      const rows = await client.from("dapp_products").select("id").eq("id", inventory.id);
      assert.ok(rows.error || !rows.data?.length, "A private QA product was exposed through direct client table access.");
      const rpc = await client.rpc("dapp_register_product", { p_actor_id: journal.actors.manufacturer.userId, p_serial_number: `${PREFIX}-DENIED-DIRECT-RPC`, p_model: "QA ACL probe", p_warranty_duration_days: 365, p_max_claims: 3 });
      assert.ok(rpc.error, "A client called a service-only mutation RPC.");
    }
  });
  console.log(`QA API acceptance complete: ${results.length} checks; ${Object.keys(journal.products).length} products. Report: ${directory}/report.json`);
} catch {
  process.exitCode = 1;
  console.error(`QA acceptance stopped. Review ${directory}/report.json; rerun the same run name to resume verified checkpoints.`);
} finally {
  await report();
  // Supabase server clients do not run persistent token refresh in this script.
}
