import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { productHex } from "./product-events";

export interface PrivatePayload {
  chain_id: number;
  contract_address: string;
  author_wallet: string;
  product_id: string;
  claim_id: string;
  kind: "description" | "reason" | "resolution";
  body: string;
  nonce: Hex;
  commitment: Hex;
}
export function payloadCommitment(
  payload: Omit<PrivatePayload, "commitment">,
): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256,address,address,bytes16,bytes16,string,bytes32,string",
      ),
      [
        BigInt(payload.chain_id),
        payload.contract_address as Address,
        payload.author_wallet as Address,
        productHex(payload.product_id),
        productHex(payload.claim_id),
        payload.kind,
        payload.nonce,
        payload.body,
      ],
    ),
  );
}
