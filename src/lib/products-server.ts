import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "./http";
import {
  chainProductsEnabled,
  chainDashboard,
  chainProductDetail,
  chainPublicProduct,
} from "./chain/products-server";
import type {
  Claim,
  DashboardData,
  OwnershipEvent,
  Product,
  ProductDetail,
  PublicProductDetail,
  ServiceRecord,
  Transfer,
} from "./types";

export const PRODUCT_COLUMNS =
  "id,serial_number,model,manufacturer_id,manufacturer_name,manufacturer_wallet,owner_id,owner_wallet,warranty_duration_days,max_claims,claims_used,warranty_started_at,warranty_expires_at,image_path,created_at";
const TRANSFER_COLUMNS =
  "id,product_id,from_user_id,to_user_id,from_wallet,to_wallet,status,created_at,resolved_at";
const CLAIM_COLUMNS =
  "id,product_id,customer_id,service_center_id,description,status,decision_reason,resolution,created_at,resolved_at";
const HISTORY_COLUMNS = "id,product_id,from_wallet,to_wallet,kind,created_at";
const TRANSFER_SELECT = `${TRANSFER_COLUMNS},product:dapp_products(model,serial_number)`;
const CLAIM_SELECT = `${CLAIM_COLUMNS},product:dapp_products(model,serial_number),center:dapp_profiles!dapp_claims_service_center_id_fkey(organization_name,display_name),customer:dapp_profiles!dapp_claims_customer_id_fkey(wallet_address)`;

export function pathId(request: Request, collection: string): string {
  const parts = new URL(request.url).pathname.split("/");
  const parsed = z.uuid().safeParse(parts[parts.indexOf(collection) + 1]);
  if (!parsed.success)
    throw new ApiError(400, "INVALID_INPUT", "Invalid resource ID.");
  return parsed.data;
}

export function databaseError(error: {
  code?: string;
  message?: string;
}): never {
  if (["PGRST205", "PGRST202", "42P01", "42883"].includes(error.code || ""))
    throw new ApiError(
      503,
      "SETUP_REQUIRED",
      "The application database is not ready yet. Please complete the Supabase setup first.",
    );
  const match =
    /^(FORBIDDEN|NOT_FOUND|INVALID_INPUT|CONFLICT|WARRANTY_UNAVAILABLE):\s*(.*)$/.exec(
      error.message || "",
    );
  if (match) {
    const status = (
      {
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        INVALID_INPUT: 400,
        CONFLICT: 409,
        WARRANTY_UNAVAILABLE: 409,
      } as Record<string, number>
    )[match[1]];
    throw new ApiError(status, match[1], match[2]);
  }
  if (error.code === "23505")
    throw new ApiError(409, "CONFLICT", "This record already exists.");
  if (["23514", "23502", "23503"].includes(error.code || ""))
    throw new ApiError(400, "INVALID_INPUT", "The supplied data is invalid.");
  throw new ApiError(
    500,
    "DATABASE_ERROR",
    "The request could not be completed. Please try again.",
  );
}

export async function businessRpc<T>(
  db: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, parameters);
  if (error) databaseError(error);
  return data as T;
}

type JoinedTransfer = Transfer & {
  product: { model: string; serial_number: string } | null;
};
type JoinedClaim = Claim & {
  product: { model: string; serial_number: string } | null;
  center: { organization_name: string | null; display_name: string } | null;
  customer: { wallet_address: string } | null;
};
function transferResult(row: JoinedTransfer): Transfer {
  const { product, ...transfer } = row;
  return { ...transfer, ...(product || {}) };
}
function claimResult(row: JoinedClaim): Claim {
  const { product, center, customer, ...claim } = row;
  return {
    ...claim,
    ...(product || {}),
    service_center_name: center?.organization_name || center?.display_name,
    customer_wallet: customer?.wallet_address,
  };
}

export async function ownedProducts(
  db: SupabaseClient,
  userId: string,
): Promise<Product[]> {
  if (chainProductsEnabled())
    return (await chainDashboard(db, userId)).products;
  const { data, error } = await db
    .from("dapp_products")
    .select(PRODUCT_COLUMNS)
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (error) databaseError(error);
  return (data || []) as unknown as Product[];
}

export async function relatedTransfers(
  db: SupabaseClient,
  userId: string,
  productId?: string,
): Promise<Transfer[]> {
  if (chainProductsEnabled())
    return (await chainDashboard(db, userId)).transfers.filter(
      (item) => !productId || item.product_id === productId,
    );
  let query = db
    .from("dapp_transfers")
    .select(TRANSFER_SELECT)
    .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) databaseError(error);
  return ((data || []) as unknown as JoinedTransfer[]).map(transferResult);
}

export async function relatedClaims(
  db: SupabaseClient,
  userId: string,
  productId?: string,
): Promise<Claim[]> {
  if (chainProductsEnabled())
    return (await chainDashboard(db, userId)).claims.filter(
      (item) => !productId || item.product_id === productId,
    );
  let query = db
    .from("dapp_claims")
    .select(CLAIM_SELECT)
    .or(`customer_id.eq.${userId},service_center_id.eq.${userId}`);
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) databaseError(error);
  return ((data || []) as unknown as JoinedClaim[]).map(claimResult);
}

export async function dashboard(
  db: SupabaseClient,
  userId: string,
): Promise<DashboardData> {
  if (chainProductsEnabled()) return chainDashboard(db, userId);
  const [products, transfers, claims] = await Promise.all([
    ownedProducts(db, userId),
    relatedTransfers(db, userId),
    relatedClaims(db, userId),
  ]);
  return { products, transfers, claims };
}

export async function productDetail(
  db: SupabaseClient,
  userId: string,
  id: string,
): Promise<ProductDetail> {
  if (chainProductsEnabled()) return chainProductDetail(db, userId, id);
  const { data, error } = await db
    .from("dapp_products")
    .select(PRODUCT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Product not found.");
  const product = data as unknown as Product;
  const [transfers, claims] = await Promise.all([
    relatedTransfers(db, userId, id),
    relatedClaims(db, userId, id),
  ]);
  if (
    product.owner_id !== userId &&
    product.manufacturer_id !== userId &&
    !transfers.length &&
    !claims.length
  )
    throw new ApiError(404, "NOT_FOUND", "Product not found.");
  const historyResult = await db
    .from("dapp_ownership_events")
    .select(HISTORY_COLUMNS)
    .eq("product_id", id)
    .order("created_at");
  if (historyResult.error) databaseError(historyResult.error);
  const services = await businessRpc<ServiceRecord[]>(
    db,
    "dapp_visible_service_records",
    { p_actor_id: userId, p_product_id: id },
  );
  return {
    product,
    transfers,
    claims,
    history: (historyResult.data || []) as unknown as OwnershipEvent[],
    services,
  };
}

function maskedWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

export async function publicProduct(
  db: SupabaseClient,
  query: string,
): Promise<PublicProductDetail> {
  if (chainProductsEnabled()) return chainPublicProduct(db, query);
  const isId = z.uuid().safeParse(query).success;
  // Query only the public subset. Full addresses are used transiently solely to
  // produce masks and never returned alongside the public payload.
  const columns =
    "id,serial_number,model,manufacturer_name,owner_wallet,created_at,image_path,warranty_duration_days,warranty_started_at,warranty_expires_at,max_claims,claims_used";
  let result = isId
    ? await db
        .from("dapp_products")
        .select(columns)
        .eq("id", query)
        .maybeSingle()
    : null;
  if (result?.error) databaseError(result.error);
  if (!result?.data) {
    // Escape LIKE metacharacters so a serial is always an exact lookup, while
    // matching the case-insensitive uniqueness rule used on registration.
    const serial = query.replace(/[\\%_]/g, "\\$&");
    result = await db
      .from("dapp_products")
      .select(columns)
      .ilike("serial_number", serial)
      .maybeSingle();
  }
  if (result.error) databaseError(result.error);
  if (!result.data)
    throw new ApiError(
      404,
      "NOT_FOUND",
      "No registered product matches this ID or serial number.",
    );
  const { owner_wallet, ...product } = result.data;
  const history = await db
    .from("dapp_ownership_events")
    .select("id,from_wallet,to_wallet,kind,created_at")
    .eq("product_id", product.id)
    .order("created_at");
  if (history.error) databaseError(history.error);
  return {
    ...product,
    owner_display: maskedWallet(owner_wallet),
    history: (history.data || []).map((event) => ({
      id: event.id,
      from_display: event.from_wallet ? maskedWallet(event.from_wallet) : null,
      to_display: maskedWallet(event.to_wallet),
      kind: event.kind,
      created_at: event.created_at,
    })),
  } as PublicProductDetail;
}
