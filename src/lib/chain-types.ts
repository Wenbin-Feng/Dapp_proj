export interface ChainStatus {
  enabled: boolean;
  ready: boolean;
  chainId?: number;
  address?: string;
  rpcUrl?: string;
  deploymentId?: string;
  administrator?: string;
  indexedBlock?: number;
  latestBlock?: number;
  walletRole?: string | null;
  error?: string;
}
export interface PreparedTransaction {
  id: string;
  entityId: string;
  kind: string;
  wallet: string;
  to: string;
  data: string;
  chainId: number;
  rpcUrl: string;
  deploymentId: string;
}
export interface ChainProgress {
  stage: "signing" | "confirming" | "syncing" | "confirmed" | "error";
  message: string;
  hash?: string;
  intentId?: string;
}
