import type {
  Claim,
  Product,
  ProductDetail,
  Transfer,
  DashboardData,
  PublicProductDetail,
} from "./types";
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options?.headers,
    },
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.error?.message || "Something went wrong. Please try again.",
    );
  return payload.data as T;
}
// The UI calls this gateway; a wallet/contract adapter can replace these HTTP operations.
export const productGateway = {
  dashboard: () => api<DashboardData>("/api/dashboard"),
  detail: (id: string) => api<ProductDetail>(`/api/products/${id}`),
  register: (input: {
    serial_number: string;
    model: string;
    warranty_duration_days: number;
    max_claims: number;
  }) =>
    api<Product>("/api/products", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  transfer: (id: string, to_wallet: string) =>
    api<Transfer>(`/api/products/${id}/transfers`, {
      method: "POST",
      body: JSON.stringify({ to_wallet }),
    }),
  transferAction: (id: string, action: "accept" | "reject" | "cancel") =>
    api<Transfer>(`/api/transfers/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
  claim: (input: {
    product_id: string;
    service_center_id: string;
    description: string;
  }) =>
    api<Claim>("/api/claims", { method: "POST", body: JSON.stringify(input) }),
  claimAction: (
    id: string,
    input: {
      action: "approve" | "reject" | "complete";
      reason?: string;
      resolution?: string;
    },
  ) =>
    api<Claim>(`/api/claims/${id}/action`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  verify: (query: string) =>
    api<PublicProductDetail>(`/api/verify?query=${encodeURIComponent(query)}`),
};
