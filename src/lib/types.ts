export const ROLES = [
  "manufacturer",
  "retailer",
  "customer",
  "service_center",
] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  manufacturer: "Manufacturer",
  retailer: "Retailer",
  customer: "Customer",
  service_center: "Service Center",
};
export interface Profile {
  id: string;
  wallet_address: string;
  display_name: string;
  role: Role;
  organization_name: string | null;
  onboarding_completed_at: string;
  created_at: string;
}
export interface Product {
  id: string;
  serial_number: string;
  model: string;
  manufacturer_id: string;
  manufacturer_name: string;
  manufacturer_wallet: string;
  owner_id: string;
  owner_wallet: string;
  warranty_duration_days: number;
  max_claims: number;
  claims_used: number;
  warranty_started_at: string | null;
  warranty_expires_at: string | null;
  image_path: string | null;
  created_at: string;
}
export type TransferStatus = "pending" | "accepted" | "rejected" | "cancelled";
export interface Transfer {
  id: string;
  product_id: string;
  from_user_id: string;
  to_user_id: string;
  from_wallet: string;
  to_wallet: string;
  status: TransferStatus;
  created_at: string;
  resolved_at: string | null;
  model?: string;
  serial_number?: string;
}
export type ClaimStatus = "submitted" | "approved" | "rejected" | "completed";
export interface Claim {
  id: string;
  product_id: string;
  customer_id: string;
  service_center_id: string;
  description: string;
  status: ClaimStatus;
  decision_reason: string | null;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  model?: string;
  serial_number?: string;
  service_center_name?: string;
  customer_wallet?: string;
}
export interface OwnershipEvent {
  id: string;
  product_id: string;
  from_wallet: string | null;
  to_wallet: string;
  kind: "registered" | "transferred";
  created_at: string;
}
export interface ServiceRecord {
  id: string;
  product_id: string;
  claim_id: string;
  service_center_id: string;
  description: string;
  created_at: string;
}
export interface ProductDetail {
  product: Product;
  history: OwnershipEvent[];
  transfers: Transfer[];
  claims: Claim[];
  services: ServiceRecord[];
}
export interface ServiceCenter {
  id: string;
  organization_name: string;
  wallet_address: string;
}
export interface DashboardData {
  products: Product[];
  transfers: Transfer[];
  claims: Claim[];
}
export interface MeData {
  profile: Profile | null;
  wallet_address: string;
}
export interface PublicProductDetail {
  id: string;
  serial_number: string;
  model: string;
  manufacturer_name: string;
  owner_display: string;
  created_at: string;
  image_path: string | null;
  warranty_duration_days: number;
  warranty_started_at: string | null;
  warranty_expires_at: string | null;
  max_claims: number;
  claims_used: number;
  history: {
    id: string;
    from_display: string | null;
    to_display: string;
    kind: string;
    created_at: string;
  }[];
}
export interface ApiResponse<T> {
  data: T;
}
export interface OperationReceipt {
  source: "mock" | "chain";
  transaction_hash: string | null;
}
