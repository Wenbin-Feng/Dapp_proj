import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { network } from "hardhat";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  parseEther,
  getAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import type { Profile } from "../src/lib/types";
import { pgliteClient } from "./fixtures/pglite-client";
import { productAbi } from "../src/lib/chain/product-abi";
import { productHex } from "../src/lib/chain/product-events";
import type {
  ProductConfig,
  ProductClient,
} from "../src/lib/chain/product-indexer";

const boundary = vi.hoisted(() => ({
  config: null as unknown as ProductConfig,
  rpc: null as unknown as ProductClient,
  db: null as unknown as ReturnType<typeof pgliteClient>["client"],
  profile: null as unknown as Profile,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/chain/server", () => ({
  getDemoConfig: async () => boundary.config,
  demoPublicClient: () => boundary.rpc,
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: async () => ({
    db: boundary.db,
    userId: boundary.profile.id,
    walletAddress: boundary.profile.wallet_address,
    profile: boundary.profile,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdmin: () => boundary.db }));

import { POST as sync } from "../src/app/api/chain/sync/route";
import { POST as prepare } from "../src/app/api/chain/private-payload/route";
import { POST as databaseRegister } from "../src/app/api/products/route";
import { POST as uploadImage } from "../src/app/api/products/[id]/image/route";
import {
  chainDashboard,
  chainProductDetail,
  chainPublicProduct,
} from "../src/lib/chain/products-server";
import { productReceiptEvents } from "../src/lib/chain/product-events";

let connection: Awaited<ReturnType<typeof network.create>>;
let pg: PGlite;
let sql: ReturnType<typeof pgliteClient>;
let wallets: ReturnType<typeof createWalletClient>[];
let addresses: Address[];
let profiles: Profile[];

const request = (path: string, body: unknown) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
async function send(
  who: number,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const wallet = wallets[who];
  const simulation = await boundary.rpc.simulateContract({
    address,
    abi,
    functionName,
    args,
    account: addresses[who],
  });
  const receipt = await boundary.rpc.waitForTransactionReceipt({
    hash: await wallet.writeContract(simulation.request),
  });
  expect(receipt.status).toBe("success");
  return receipt;
}
async function synchronize(hash?: Hash) {
  const response = await sync(
    request("/api/chain/sync", hash ? { transaction_hash: hash } : {}),
  );
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

beforeAll(async () => {
  vi.stubEnv("PRODUCT_BACKEND", "chain");
  connection = await network.create("hardhat");
  const chain = defineChain({
    id: 31337,
    name: "Hardhat",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  });
  const transport = custom(connection.provider);
  boundary.rpc = createPublicClient({
    chain,
    transport,
    cacheTime: 0,
  }) as ProductClient;
  addresses = await createWalletClient({ chain, transport }).getAddresses();
  wallets = addresses.map((account) =>
    createWalletClient({ account, chain, transport }),
  );
  async function deploy(name: string, args: readonly unknown[]) {
    const build = JSON.parse(
      await readFile(
        new URL(
          `../artifacts/contracts/${name}.sol/${name}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const receipt = await boundary.rpc.waitForTransactionReceipt({
      hash: await wallets[0].deployContract({
        account: addresses[0],
        chain,
        abi: build.abi,
        bytecode: build.bytecode,
        args,
      }),
    });
    return getAddress(receipt.contractAddress!);
  }
  const pdc = await deploy("DemoToken", ["PDC", "PDC", addresses[0]]);
  const pdq = await deploy("DemoToken", ["PDQ", "PDQ", addresses[0]]);
  const products = await deploy("DemoProducts", [pdc]);
  boundary.config = {
    version: "demo-v1",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    productBackend: "chain",
    products,
    pdc,
    pdq,
    treasury: addresses[0],
    fromBlock: "0",
  };
  pg = new PGlite();
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;",
  );
  for (const filename of [
    "202610140001_initial.sql",
    "202610160001_demo_chain.sql",
  ])
    await pg.exec(
      await readFile(
        new URL(`../supabase/migrations/${filename}`, import.meta.url),
        "utf8",
      ),
    );
  sql = pgliteClient(pg);
  boundary.db = sql.client;
  profiles = [];
  for (const [index, role] of (
    [
      "manufacturer",
      "retailer",
      "customer",
      "customer",
      "service_center",
    ] as const
  ).entries()) {
    const profile: Profile = {
      id: randomUUID(),
      wallet_address: addresses[index].toLowerCase(),
      role,
      display_name: `Demo ${role}`,
      organization_name: role === "customer" ? null : `Demo ${role}`,
      created_at: new Date().toISOString(),
      onboarding_completed_at: new Date().toISOString(),
    };
    profiles.push(profile);
    await pg.query("insert into auth.users values($1)", [profile.id]);
    await pg.query(
      "insert into public.dapp_profiles(id,wallet_address,display_name,role,organization_name,onboarding_completed_at) values($1,$2,$3,$4,$5,now())",
      [
        profile.id,
        profile.wallet_address,
        profile.display_name,
        profile.role,
        profile.organization_name,
      ],
    );
    await send(index, products, productAbi, "enroll", [
      index === 0 ? 1 : index === 1 ? 2 : index === 4 ? 4 : 3,
    ]);
  }
  boundary.profile = profiles[0];
  await send(0, pdc, erc20Abi, "transfer", [addresses[2], parseEther("1000")]);
}, 60000);

it("preserves chain-manufacturer image authorization and compare-and-swap protection", async () => {
  const id = randomUUID();
  const registered = await send(
    0,
    boundary.config.products,
    productAbi,
    "registerProduct",
    [productHex(id), "IMAGE-COURSE-001", "Image test", 365, 1],
  );
  await synchronize(registered.transactionHash);
  const paths: string[] = [];
  let concurrent = false;
  const winner = `products/${id}/concurrent.webp`;
  const upload = vi.fn(async (path: string) => {
    paths.push(path);
    if (concurrent)
      await pg.query(
        "update dapp_demo_product_images set image_path=$1 where product_id=$2",
        [winner, id],
      );
    return { error: null };
  });
  const remove = vi.fn(async () => ({ error: null }));
  Object.assign(boundary.db, { storage: { from: () => ({ upload, remove }) } });
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#41c7a3" },
  })
    .png()
    .toBuffer();
  function imageRequest() {
    const body = new FormData();
    body.set(
      "file",
      new File([new Uint8Array(png)], "demo.png", { type: "image/png" }),
    );
    return new Request(`http://localhost:3000/api/products/${id}/image`, {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body,
    });
  }
  boundary.profile = profiles[4];
  expect(
    (await uploadImage(imageRequest(), { params: Promise.resolve({ id }) }))
      .status,
  ).toBe(403);
  expect(upload).not.toHaveBeenCalled();
  boundary.profile = profiles[0];
  const first = await uploadImage(imageRequest(), {
    params: Promise.resolve({ id }),
  });
  expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
  expect((await first.json()).data.image_path).toBe(paths[0]);
  concurrent = true;
  expect(
    (await uploadImage(imageRequest(), { params: Promise.resolve({ id }) }))
      .status,
  ).toBe(409);
  expect(
    (
      await pg.query<{ image_path: string }>(
        "select image_path from dapp_demo_product_images where product_id=$1",
        [id],
      )
    ).rows[0].image_path,
  ).toBe(winner);
  expect(remove).toHaveBeenCalledWith([paths[1]]);
}, 30000);
afterAll(async () => {
  await connection?.close();
  await pg?.close();
  vi.unstubAllEnvs();
});

it("runs real receipts through SQL, rejects forged evidence, rebuilds reorgs and protects repair privacy", async () => {
  const { products, pdc } = boundary.config;
  const id = randomUUID(),
    inventory = randomUUID(),
    offer = randomUUID(),
    claim = randomUUID(),
    resale = randomUUID();
  const registered = await send(0, products, productAbi, "registerProduct", [
    productHex(id),
    "0xCourse-001",
    "0xCourseModel",
    365,
    3,
  ]);
  await synchronize(registered.transactionHash);
  expect(
    (await chainProductDetail(boundary.db, profiles[0].id, id)).product.model,
  ).toBe("0xCourseModel");
  const eventCount = async () =>
    (
      await pg.query<{ n: number }>(
        "select count(*)::int n from dapp_demo_chain_events",
      )
    ).rows[0].n;
  const count = await eventCount();
  await synchronize(registered.transactionHash);
  expect(await eventCount()).toBe(count);
  const writes = sql.writes;
  const forged = await sync(
    request("/api/chain/sync", { transaction_hash: `0x${"f".repeat(64)}` }),
  );
  expect(forged.status).toBe(400);
  expect(sql.writes).toBe(writes);
  const unrelated = await send(0, pdc, erc20Abi, "transfer", [
    addresses[3],
    1n,
  ]);
  const unrelatedResponse = await sync(
    request("/api/chain/sync", { transaction_hash: unrelated.transactionHash }),
  );
  expect(unrelatedResponse.status).toBe(400);
  expect(sql.writes).toBe(writes);
  expect((await databaseRegister(request("/api/products", {}))).status).toBe(
    409,
  );
  await send(0, products, productAbi, "requestTransfer", [
    productHex(inventory),
    productHex(id),
    addresses[1],
  ]);
  const stock = await send(1, products, productAbi, "acceptTransfer", [
    productHex(inventory),
  ]);
  await synchronize(stock.transactionHash);
  expect(
    (await chainProductDetail(boundary.db, profiles[0].id, id)).product
      .warranty_started_at,
  ).toBeNull();
  boundary.profile = profiles[1];
  await send(1, products, productAbi, "createPaidOffer", [
    productHex(offer),
    productHex(id),
    addresses[2],
    parseEther("100"),
    (await boundary.rpc.getBlock()).timestamp + 3600n,
  ]);
  await send(2, pdc, erc20Abi, "approve", [products, parseEther("100")]);
  const snapshot = await connection.provider.request({
    method: "evm_snapshot",
  });
  const accepted = await send(2, products, productAbi, "acceptPaidOffer", [
    productHex(offer),
  ]);
  const invalidReceipt = {
    ...accepted,
    logs: accepted.logs.filter((log) => getAddress(log.address) !== pdc),
  };
  expect(() => productReceiptEvents(invalidReceipt, boundary.config)).toThrow(
    "matching PDC payment",
  );
  boundary.profile = profiles[2];
  await synchronize(accepted.transactionHash);
  const acquired = await chainProductDetail(boundary.db, profiles[2].id, id);
  expect(acquired.product.owner_wallet).toBe(profiles[2].wallet_address);
  expect(acquired.product.warranty_started_at).not.toBeNull();
  expect(acquired.history.at(-1)?.price_pdc).toBe(parseEther("100").toString());
  await connection.provider.request({
    method: "evm_revert",
    params: [snapshot],
  });
  // Live ownership is checked before returning any private read-model data.
  await expect(
    chainDashboard(boundary.db, profiles[2].id),
  ).rejects.toMatchObject({ code: "CHAIN_REORG" });
  expect((await synchronize()).reset).toBe(true);
  const restored = await chainProductDetail(boundary.db, profiles[1].id, id);
  expect(restored.product.warranty_started_at).toBeNull();
  expect(restored.transfers.find((t) => t.id === offer)?.status).toBe(
    "pending",
  );
  const boughtAgain = await send(2, products, productAbi, "acceptPaidOffer", [
    productHex(offer),
  ]);
  await synchronize(boughtAgain.transactionHash);
  const privateDescription = "Private customer battery details";
  const draftResponse = await prepare(
    request("/api/chain/private-payload", {
      product_id: id,
      claim_id: claim,
      kind: "description",
      body: privateDescription,
    }),
  );
  expect(
    draftResponse.status,
    JSON.stringify(await draftResponse.clone().json()),
  ).toBe(201);
  const draft = (await draftResponse.json()).data;
  const submitted = await send(2, products, productAbi, "submitClaim", [
    productHex(claim),
    productHex(id),
    addresses[4],
    draft.commitment,
  ]);
  await synchronize(submitted.transactionHash);
  expect(
    (await chainProductDetail(boundary.db, profiles[2].id, id)).claims[0]
      .description,
  ).toBe(privateDescription);
  expect(
    (await chainProductDetail(boundary.db, profiles[0].id, id)).claims,
  ).toHaveLength(0);
  boundary.profile = profiles[4];
  await send(4, products, productAbi, "approveClaim", [productHex(claim)]);
  const resolution = "Private completed repair notes";
  const repairResponse = await prepare(
    request("/api/chain/private-payload", {
      product_id: id,
      claim_id: claim,
      kind: "resolution",
      body: resolution,
    }),
  );
  expect(repairResponse.status).toBe(201);
  const repair = (await repairResponse.json()).data;
  const completed = await send(4, products, productAbi, "completeClaim", [
    productHex(claim),
    repair.commitment,
  ]);
  await synchronize(completed.transactionHash);
  const manufacturer = await chainProductDetail(
    boundary.db,
    profiles[0].id,
    id,
  );
  expect(manufacturer.services).toHaveLength(0);
  expect(JSON.stringify(manufacturer)).not.toContain(resolution);
  const publicData = await chainPublicProduct(boundary.db, "0xcourse-001");
  expect(JSON.stringify(publicData)).not.toContain(privateDescription);
  expect(JSON.stringify(publicData)).not.toContain(resolution);
  expect(JSON.stringify(publicData)).not.toContain(profiles[2].wallet_address);
  expect(publicData.claims_used).toBe(1);
  expect(publicData.history.at(-1)?.transaction_hash).toBe(
    boughtAgain.transactionHash,
  );
  await send(2, products, productAbi, "requestTransfer", [
    productHex(resale),
    productHex(id),
    addresses[3],
  ]);
  const moved = await send(3, products, productAbi, "acceptTransfer", [
    productHex(resale),
  ]);
  await synchronize(moved.transactionHash);
  const newOwner = await chainProductDetail(boundary.db, profiles[3].id, id);
  expect(newOwner.claims).toHaveLength(0);
  expect(newOwner.services[0].description).toBe(resolution);
  expect(newOwner.product.claims_used).toBe(1);
  expect(newOwner.product.warranty_started_at).toBe(
    (await chainProductDetail(boundary.db, profiles[2].id, id)).product
      .warranty_started_at,
  );
  // A modified database text does not match its salted on-chain commitment.
  await pg.query(
    "update dapp_demo_private_payloads set body='tampered' where commitment=$1",
    [repair.commitment],
  );
  expect(
    (await chainProductDetail(boundary.db, profiles[3].id, id)).services[0]
      .description,
  ).not.toBe("tampered");
  await send(5, products, productAbi, "enroll", [1]);
  const outside = randomUUID();
  const outsideReceipt = await send(
    5,
    products,
    productAbi,
    "registerProduct",
    [productHex(outside), "OUTSIDE-WEBSITE", "External demo", 365, 1],
  );
  await synchronize(outsideReceipt.transactionHash);
  expect(
    JSON.stringify(await chainPublicProduct(boundary.db, outside)),
  ).not.toContain(addresses[5].toLowerCase());
}, 60000);
