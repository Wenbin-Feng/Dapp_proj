import type { Claim, Product, Transfer, OwnershipEvent } from "@/lib/types";
import type { ProductEvent } from "./product-events";

export interface IndexedClaim extends Claim {
  center_wallet: string;
  customer_wallet: string;
  description_hash: string;
  reason_hash: string;
  resolution_hash: string;
}
export interface ProductState {
  products: Map<string, Product>;
  transfers: Map<string, Transfer>;
  claims: Map<string, IndexedClaim>;
  history: OwnershipEvent[];
}
export const chainDate = (seconds: string | number | bigint) =>
  new Date(Number(seconds) * 1000).toISOString();
const text = (value: string | number) => String(value);

export function reduceProductEvents(events: ProductEvent[]): ProductState {
  const state: ProductState = {
    products: new Map(),
    transfers: new Map(),
    claims: new Map(),
    history: [],
  };
  for (const event of events) {
    const a = event.payload;
    const productId = event.product_id;
    if (event.event_name === "RoleEnrolled") continue;
    if (!productId) throw new Error("Product event is missing its product ID");
    const timestamp = chainDate(a.timestamp);
    if (event.event_name === "ProductRegistered") {
      const manufacturer = text(a.manufacturer);
      state.products.set(productId, {
        id: productId,
        serial_number: text(a.serial),
        model: text(a.model),
        manufacturer_id: manufacturer,
        manufacturer_name: manufacturer,
        manufacturer_wallet: manufacturer,
        owner_id: manufacturer,
        owner_wallet: manufacturer,
        warranty_duration_days: Number(a.warrantyDays),
        max_claims: Number(a.maxClaims),
        claims_used: 0,
        warranty_started_at: null,
        warranty_expires_at: null,
        image_path: null,
        created_at: timestamp,
        chain: { transaction_hash: event.transaction_hash },
      });
      state.history.push({
        id: `${event.transaction_hash}:${event.log_index}`,
        product_id: productId,
        from_wallet: null,
        to_wallet: manufacturer,
        kind: "registered",
        created_at: timestamp,
        transaction_hash: event.transaction_hash,
      });
      continue;
    }
    const product = state.products.get(productId);
    if (!product)
      throw new Error(
        "Product read model is incomplete; rebuild from the registry deployment block",
      );
    if (event.event_name === "TransferRequested") {
      state.transfers.set(text(a.transferId), {
        id: text(a.transferId),
        product_id: productId,
        from_user_id: text(a.seller),
        to_user_id: text(a.buyer),
        from_wallet: text(a.seller),
        to_wallet: text(a.buyer),
        status: "pending",
        created_at: timestamp,
        resolved_at: null,
        price_pdc: text(a.price),
        expires_at: BigInt(a.expiresAt) ? chainDate(a.expiresAt) : null,
        request_hash: event.transaction_hash,
      });
    } else if (event.event_name === "TransferResolved") {
      const transfer = state.transfers.get(text(a.transferId));
      if (!transfer) throw new Error("Missing offer creation event");
      transfer.status = (
        { 2: "accepted", 3: "rejected", 4: "cancelled" } as const
      )[Number(a.status) as 2 | 3 | 4];
      transfer.resolved_at = timestamp;
      transfer.transaction_hash = event.transaction_hash;
      if (transfer.status === "accepted") {
        product.owner_id = product.owner_wallet = text(a.buyer);
        product.warranty_started_at = BigInt(a.warrantyStarted)
          ? chainDate(a.warrantyStarted)
          : null;
        product.warranty_expires_at = product.warranty_started_at
          ? chainDate(
              BigInt(a.warrantyStarted) +
                BigInt(product.warranty_duration_days) * 86400n,
            )
          : null;
        state.history.push({
          id: `${event.transaction_hash}:${event.log_index}`,
          product_id: productId,
          from_wallet: text(a.seller),
          to_wallet: text(a.buyer),
          kind: "transferred",
          created_at: timestamp,
          transaction_hash: event.transaction_hash,
          price_pdc: text(a.price),
        });
      }
    } else if (event.event_name === "ClaimSubmitted") {
      state.claims.set(text(a.claimId), {
        id: text(a.claimId),
        product_id: productId,
        customer_id: text(a.customer),
        customer_wallet: text(a.customer),
        service_center_id: text(a.center),
        center_wallet: text(a.center),
        description:
          "Private description is unavailable. It may have been submitted outside this website.",
        decision_reason: null,
        resolution: null,
        description_hash: text(a.descriptionHash),
        reason_hash: "",
        resolution_hash: "",
        status: "submitted",
        created_at: timestamp,
        resolved_at: null,
      });
    } else if (event.event_name === "ClaimResolved") {
      const claim = state.claims.get(text(a.claimId));
      if (!claim) throw new Error("Missing claim submission event");
      claim.status = (
        { 2: "approved", 3: "rejected", 4: "completed" } as const
      )[Number(a.status) as 2 | 3 | 4];
      claim.reason_hash = text(a.reasonHash);
      claim.resolution_hash = text(a.resolutionHash);
      if (claim.status !== "approved") claim.resolved_at = timestamp;
      product.claims_used = Number(a.claimsUsed);
    }
  }
  return state;
}
