import type {
  Claim,
  Product,
  ProductDetail,
  Transfer,
  DashboardData,
  PublicProductDetail,
} from "./types";
import { api } from "./api-http";
import { performMutation } from "./chain-client";
export { api } from "./api-http";
// Chain mode signs wallet transactions; local-only mode remains available for isolated tests.
export const productGateway = {
  dashboard: () => api<DashboardData>("/api/dashboard"),
  detail: (id: string) => api<ProductDetail>(`/api/products/${id}`),
  register: (input: {
    serial_number: string;
    manufacturer_name?: string;
    model: string;
    warranty_duration_days: number;
    max_claims: number;
  }) =>
    performMutation<Product>("/api/products", input, {
      kind: "register",
      ...input,
    }),
  transfer: (id: string, to_wallet: string) =>
    performMutation<Transfer>(
      `/api/products/${id}/transfers`,
      { to_wallet },
      { kind: "transfer", product_id: id, to_wallet },
    ),
  transferAction: (id: string, action: "accept" | "reject" | "cancel") =>
    performMutation<Transfer>(
      `/api/transfers/${id}/action`,
      { action },
      { kind: "transferAction", id, action },
    ),
  claim: (input: {
    product_id: string;
    service_center_id: string;
    description: string;
  }) =>
    performMutation<Claim>("/api/claims", input, { kind: "claim", ...input }),
  claimAction: (
    id: string,
    input: {
      action: "approve" | "reject" | "complete";
      reason?: string;
      resolution?: string;
    },
  ) =>
    performMutation<Claim>(`/api/claims/${id}/action`, input, {
      kind: "claimAction",
      id,
      ...input,
    }),
  verify: (query: string) =>
    api<PublicProductDetail>(`/api/verify?query=${encodeURIComponent(query)}`),
};
