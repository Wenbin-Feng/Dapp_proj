import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAddress, type Address } from "viem";
import { ApiError } from "@/lib/http";
import type {
  Claim,
  DashboardData,
  Product,
  ProductDetail,
  Profile,
  PublicProductDetail,
  ServiceRecord,
  Transfer,
} from "@/lib/types";
import { getDemoConfig, demoPublicClient } from "./server";
import { productAbi } from "./product-abi";
import { productHex, type ProductEvent } from "./product-events";
import {
  reduceProductEvents,
  chainDate,
  type IndexedClaim,
} from "./product-state";
import { payloadCommitment, type PrivatePayload } from "./private-payload";
import {
  checkProductDeployment,
  chainDatabaseError,
  type ProductConfig,
} from "./product-indexer";

export const chainProductsEnabled = () =>
  process.env.PRODUCT_BACKEND === "chain";
export function requireDatabaseProducts() {
  if (chainProductsEnabled())
    throw new ApiError(
      409,
      "WALLET_TRANSACTION_REQUIRED",
      "This deployment uses wallet transactions for products. Refresh the page and use the chain-enabled interface.",
    );
}
export async function productConfiguration(): Promise<ProductConfig> {
  const config = await getDemoConfig();
  if (!config?.products)
    throw new ApiError(
      503,
      "CHAIN_SETUP_REQUIRED",
      "Configure the deployed product registry first.",
    );
  return { ...config, products: config.products };
}
const scope = (config: ProductConfig) => ({
  chain_id: config.chainId,
  contract_address: config.products.toLowerCase(),
});

async function readEvents(
  db: SupabaseClient,
  config: ProductConfig,
  productId?: string,
) {
  const events: ProductEvent[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    let query = db
      .from("dapp_demo_chain_events")
      .select(
        "block_number,block_hash,transaction_hash,log_index,event_name,product_id,payload",
      )
      .match(scope(config));
    if (productId) query = query.eq("product_id", productId);
    const result = await query
      .order("block_number")
      .order("log_index")
      .range(offset, offset + 999);
    if (result.error) chainDatabaseError(result.error);
    events.push(...(result.data as ProductEvent[]));
    if (result.data.length < 1000) return events;
  }
  throw new ApiError(
    503,
    "DEMO_INDEX_LIMIT",
    "The classroom event query limit was reached. Add paged projections before importing more history.",
  );
}

async function actor(db: SupabaseClient, userId: string) {
  const result = await db
    .from("dapp_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (result.error) chainDatabaseError(result.error);
  if (!result.data)
    throw new ApiError(401, "PROFILE_REQUIRED", "Complete your profile first.");
  return result.data as Profile;
}

async function dataset(db: SupabaseClient, productId?: string) {
  const config = await productConfiguration();
  const client = demoPublicClient(config);
  await checkProductDeployment(client, config);
  const checkpoint = await db
    .from("dapp_demo_chain_sync")
    .select("next_block,anchor_hash")
    .match(scope(config))
    .maybeSingle();
  if (checkpoint.error) chainDatabaseError(checkpoint.error);
  if (checkpoint.data?.anchor_hash) {
    const anchor = BigInt(checkpoint.data.next_block) - 1n;
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const block =
      anchor <= head ? await client.getBlock({ blockNumber: anchor }) : null;
    if (block?.hash !== checkpoint.data.anchor_hash)
      throw new ApiError(
        409,
        "CHAIN_REORG",
        "The indexed chain changed. Sync products to rebuild its canonical evidence before reading records.",
      );
  }
  const state = reduceProductEvents(await readEvents(db, config, productId));
  const wallets = new Set<string>();
  const products = [...state.products.values()];
  // Chain state governs current ownership and warranty, including when the index is behind.
  for (let offset = 0; offset < products.length; offset += 20) {
    await Promise.all(
      products.slice(offset, offset + 20).map(async (p) => {
        const live = await client.readContract({
          address: config.products,
          abi: productAbi,
          functionName: "getProduct",
          args: [productHex(p.id)],
        });
        p.owner_wallet = live.owner.toLowerCase();
        p.claims_used = live.claimsUsed;
        p.warranty_started_at = live.warrantyStarted
          ? chainDate(live.warrantyStarted)
          : null;
        p.warranty_expires_at = live.warrantyStarted
          ? chainDate(live.warrantyStarted + BigInt(live.warrantyDays) * 86400n)
          : null;
        wallets.add(p.owner_wallet);
        wallets.add(p.manufacturer_wallet);
      }),
    );
  }
  for (const t of state.transfers.values()) {
    wallets.add(t.from_wallet);
    wallets.add(t.to_wallet);
  }
  for (const c of state.claims.values()) {
    wallets.add(c.customer_wallet);
    wallets.add(c.center_wallet);
  }
  const profiles = new Map<string, Profile>();
  const walletList = [...wallets];
  for (let offset = 0; offset < walletList.length; offset += 100) {
    const result = await db
      .from("dapp_profiles")
      .select("*")
      .in("wallet_address", walletList.slice(offset, offset + 100));
    if (result.error) chainDatabaseError(result.error);
    for (const profile of result.data as Profile[])
      profiles.set(profile.wallet_address, profile);
  }
  const userId = (wallet: string) => profiles.get(wallet)?.id || wallet;
  for (const p of products) {
    p.owner_id = userId(p.owner_wallet);
    p.manufacturer_id = userId(p.manufacturer_wallet);
    p.manufacturer_name =
      profiles.get(p.manufacturer_wallet)?.organization_name ||
      profiles.get(p.manufacturer_wallet)?.display_name ||
      `${p.manufacturer_wallet.slice(0, 6)}…${p.manufacturer_wallet.slice(-4)}`;
  }
  for (const t of state.transfers.values()) {
    t.from_user_id = userId(t.from_wallet);
    t.to_user_id = userId(t.to_wallet);
    Object.assign(t, {
      model: state.products.get(t.product_id)?.model,
      serial_number: state.products.get(t.product_id)?.serial_number,
    });
  }
  for (const c of state.claims.values()) {
    c.customer_id = userId(c.customer_wallet);
    c.service_center_id = userId(c.center_wallet);
    c.service_center_name =
      profiles.get(c.center_wallet)?.organization_name ||
      profiles.get(c.center_wallet)?.display_name ||
      c.center_wallet;
    Object.assign(c, {
      model: state.products.get(c.product_id)?.model,
      serial_number: state.products.get(c.product_id)?.serial_number,
    });
  }
  if (products.length) {
    const images = await db
      .from("dapp_demo_product_images")
      .select("product_id,image_path")
      .match(scope(config));
    if (images.error) chainDatabaseError(images.error);
    for (const image of images.data) {
      const p = state.products.get(image.product_id);
      if (p) p.image_path = image.image_path;
    }
  }
  return { ...state, config, client };
}

function visibleClaim(c: IndexedClaim): Claim {
  const {
    center_wallet,
    description_hash,
    reason_hash,
    resolution_hash,
    ...claim
  } = c;
  void center_wallet;
  void description_hash;
  void reason_hash;
  void resolution_hash;
  return claim;
}
async function privateText(
  db: SupabaseClient,
  config: ProductConfig,
  claims: IndexedClaim[],
) {
  for (let offset = 0; offset < claims.length; offset += 100) {
    const portion = claims.slice(offset, offset + 100);
    const hashes = portion
      .flatMap((c) => [c.description_hash, c.reason_hash, c.resolution_hash])
      .filter((v) => /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n);
    if (!hashes.length) continue;
    const result = await db
      .from("dapp_demo_private_payloads")
      .select("*")
      .match(scope(config))
      .in("commitment", hashes);
    if (result.error) chainDatabaseError(result.error);
    for (const payload of result.data as PrivatePayload[]) {
      const claim = portion.find(
        (c) => c.id === payload.claim_id && c.product_id === payload.product_id,
      );
      if (!claim || payloadCommitment(payload) !== payload.commitment) continue;
      const expectedActor =
        payload.kind === "description"
          ? claim.customer_wallet
          : claim.center_wallet;
      if (payload.author_wallet !== expectedActor) continue;
      if (
        payload.kind === "description" &&
        payload.commitment === claim.description_hash
      )
        claim.description = payload.body;
      if (payload.kind === "reason" && payload.commitment === claim.reason_hash)
        claim.decision_reason = payload.body;
      if (
        payload.kind === "resolution" &&
        payload.commitment === claim.resolution_hash
      )
        claim.resolution = payload.body;
    }
  }
}

export async function chainDashboard(
  db: SupabaseClient,
  userId: string,
): Promise<DashboardData> {
  const profile = await actor(db, userId);
  const data = await dataset(db);
  const claims = [...data.claims.values()].filter(
    (c) =>
      c.customer_wallet === profile.wallet_address ||
      c.center_wallet === profile.wallet_address,
  );
  await privateText(db, data.config, claims);
  return {
    products: [...data.products.values()]
      .filter((p) => p.owner_wallet === profile.wallet_address)
      .reverse(),
    transfers: [...data.transfers.values()]
      .filter(
        (t) =>
          t.from_wallet === profile.wallet_address ||
          t.to_wallet === profile.wallet_address,
      )
      .reverse(),
    claims: claims.map(visibleClaim).reverse(),
  };
}
export async function chainProductDetail(
  db: SupabaseClient,
  userId: string,
  id: string,
): Promise<ProductDetail> {
  const profile = await actor(db, userId);
  const data = await dataset(db, id);
  const product = data.products.get(id);
  if (!product)
    throw new ApiError(
      404,
      "NOT_INDEXED",
      "Product not found in the confirmed index. Sync the chain if its transaction already succeeded.",
    );
  const transfers = [...data.transfers.values()].filter(
    (t) =>
      t.from_wallet === profile.wallet_address ||
      t.to_wallet === profile.wallet_address,
  );
  const claims = [...data.claims.values()].filter(
    (c) =>
      c.customer_wallet === profile.wallet_address ||
      c.center_wallet === profile.wallet_address,
  );
  const owns = product.owner_wallet === profile.wallet_address;
  if (
    !owns &&
    product.manufacturer_wallet !== profile.wallet_address &&
    !transfers.length &&
    !claims.length
  )
    throw new ApiError(404, "NOT_FOUND", "Product not found.");
  const serviceClaims = [...data.claims.values()].filter(
    (c) =>
      c.status === "completed" &&
      (owns ||
        c.customer_wallet === profile.wallet_address ||
        c.center_wallet === profile.wallet_address),
  );
  await privateText(db, data.config, [
    ...new Set([...claims, ...serviceClaims]),
  ]);
  const services: ServiceRecord[] = serviceClaims.map((c) => ({
    id: c.id,
    product_id: id,
    claim_id: c.id,
    service_center_id: c.service_center_id,
    description:
      c.resolution ||
      "Repair confirmed on chain; private repair notes are unavailable.",
    created_at: c.resolved_at!,
  }));
  return {
    product,
    history: data.history,
    transfers: transfers.reverse(),
    claims: claims.map(visibleClaim).reverse(),
    services,
  };
}
export async function chainPublicProduct(
  db: SupabaseClient,
  query: string,
): Promise<PublicProductDetail> {
  const data = await dataset(db);
  const product =
    data.products.get(query) ||
    [...data.products.values()].find(
      (p) => p.serial_number.toLowerCase() === query.toLowerCase(),
    );
  if (!product)
    throw new ApiError(
      404,
      "NOT_FOUND",
      "No confirmed product matches this ID or serial. If registration just succeeded, sync its events first.",
    );
  const mask = (wallet: string) => `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  return {
    id: product.id,
    serial_number: product.serial_number,
    model: product.model,
    manufacturer_name: product.manufacturer_name,
    owner_display: mask(product.owner_wallet),
    created_at: product.created_at,
    image_path: product.image_path,
    warranty_duration_days: product.warranty_duration_days,
    warranty_started_at: product.warranty_started_at,
    warranty_expires_at: product.warranty_expires_at,
    max_claims: product.max_claims,
    claims_used: product.claims_used,
    history: data.history
      .filter((event) => event.product_id === product.id)
      .map((event) => ({
        id: event.id,
        from_display: event.from_wallet ? mask(event.from_wallet) : null,
        to_display: mask(event.to_wallet),
        kind: event.kind,
        created_at: event.created_at,
        transaction_hash: event.transaction_hash,
        price_pdc: event.price_pdc,
      })),
  };
}

export async function chainImageProduct(
  db: SupabaseClient,
  wallet: string,
  userId: string,
  id: string,
) {
  const config = await productConfiguration();
  const client = demoPublicClient(config);
  await checkProductDeployment(client, config);
  const product = await client.readContract({
    address: config.products,
    abi: productAbi,
    functionName: "getProduct",
    args: [productHex(id)],
  });
  if (getAddress(product.manufacturer) !== getAddress(wallet))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only the product manufacturer can update its image.",
    );
  const reserve = await db.from("dapp_demo_product_images").upsert(
    { ...scope(config), product_id: id, image_path: null },
    {
      onConflict: "chain_id,contract_address,product_id",
      ignoreDuplicates: true,
    },
  );
  if (reserve.error) chainDatabaseError(reserve.error);
  const image = await db
    .from("dapp_demo_product_images")
    .select("image_path")
    .match({ ...scope(config), product_id: id })
    .maybeSingle();
  if (image.error) chainDatabaseError(image.error);
  return {
    id,
    manufacturer_id: userId,
    image_path: image.data?.image_path || null,
    scope: scope(config),
  };
}
