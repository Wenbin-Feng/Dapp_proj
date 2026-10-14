import type { Product, PublicProductDetail } from "./types";
export function shortWallet(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
export function formatDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Not started";
}
export function warrantyStatus(
  product: Pick<
    Product | PublicProductDetail,
    "warranty_started_at" | "warranty_expires_at" | "claims_used" | "max_claims"
  >,
  now = Date.now(),
): "not_started" | "active" | "expired" | "exhausted" {
  if (!product.warranty_started_at) return "not_started";
  if (product.claims_used >= product.max_claims) return "exhausted";
  if (
    !product.warranty_expires_at ||
    now >= new Date(product.warranty_expires_at).getTime()
  )
    return "expired";
  return "active";
}
export const WARRANTY_LABELS = {
  not_started: "Starts on first sale",
  active: "Warranty active",
  expired: "Warranty expired",
  exhausted: "Claim limit reached",
};
export function productImageUrl(path: string | null) {
  if (!path) return null;
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "dapp";
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
