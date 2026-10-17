import {
  decodeEventLog,
  erc20Abi,
  getAddress,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { productAbi } from "./product-abi";
import type { DemoConfig } from "./config";

export function productHex(id: string): Hex {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new Error("A UUID v4 product or operation ID is required.");
  return `0x${id.replaceAll("-", "").toLowerCase()}`;
}
export function productId(id: Hex): string {
  const value = id.slice(2).toLowerCase();
  if (value.length !== 32) throw new Error("Invalid contract operation ID");
  const uuid = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  productHex(uuid);
  return uuid;
}
export interface ProductEvent {
  block_number: string;
  block_hash: Hash;
  transaction_hash: Hash;
  log_index: number;
  event_name: string;
  product_id: string | null;
  payload: Record<string, string | number>;
}

// Called only after the server has checked chain ID, canonical block and confirmations.
export function productReceiptEvents(
  receipt: TransactionReceipt,
  config: DemoConfig,
): ProductEvent[] {
  if (receipt.status !== "success" || !config.products)
    throw new Error("A successful product receipt is required.");
  return receipt.logs
    .filter((log) => getAddress(log.address) === config.products)
    .flatMap((log) => {
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: productAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
      } catch {
        return [];
      }
      const payload = Object.fromEntries(
        Object.entries(decoded.args).map(([key, value]) => [
          key,
          ["productId", "transferId", "claimId"].includes(key)
            ? productId(value as Hex)
            : typeof value === "bigint"
              ? value.toString()
              : typeof value === "string" &&
                  /^(manufacturer|seller|buyer|actor|center|customer|wallet|.*Hash)$/.test(
                    key,
                  )
                ? value.toLowerCase()
                : value,
        ]),
      ) as ProductEvent["payload"];
      if (
        decoded.eventName === "TransferResolved" &&
        Number(payload.status) === 2 &&
        BigInt(payload.price) > 0n
      ) {
        const paid = receipt.logs.some((payment) => {
          if (getAddress(payment.address) !== config.pdc) return false;
          try {
            const transfer = decodeEventLog({
              abi: erc20Abi,
              eventName: "Transfer",
              data: payment.data,
              topics: payment.topics,
            });
            return (
              transfer.args.from.toLowerCase() === payload.buyer &&
              transfer.args.to.toLowerCase() === payload.seller &&
              transfer.args.value === BigInt(payload.price)
            );
          } catch {
            return false;
          }
        });
        if (!paid)
          throw new Error("Paid ownership event has no matching PDC payment.");
      }
      return [
        {
          block_number: receipt.blockNumber.toString(),
          block_hash: receipt.blockHash,
          transaction_hash: receipt.transactionHash,
          log_index: log.logIndex,
          event_name: decoded.eventName,
          product_id:
            typeof payload.productId === "string" ? payload.productId : null,
          payload,
        },
      ];
    });
}
