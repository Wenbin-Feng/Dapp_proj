import { chainManifest } from "@/lib/chain-config";
import { readJson } from "@/lib/http";
import { z } from "zod";

// MetaMask signs on the user's device. The hosted endpoint only forwards
// wallet reads and signed transactions; node account and admin APIs stay local.
const methods = new Set([
  "eth_chainId", "net_version", "eth_blockNumber", "eth_getBalance", "eth_call",
  "eth_getCode", "eth_estimateGas", "eth_gasPrice", "eth_feeHistory",
  "eth_maxPriorityFeePerGas", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash",
  "eth_sendRawTransaction", "eth_syncing", "web3_clientVersion"
]);
const item = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.number(), z.string(), z.null()]),
  method: z.string(), params: z.array(z.unknown()).max(8).optional()
}).strict();
const schema = z.union([item, z.array(item).min(1).max(16)]);
const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
export function OPTIONS() {
  return new Response(null, { headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
export async function POST(request: Request) {
  try {
    const body = await readJson(request, schema);
    const items = Array.isArray(body) ? body : [body];
    if (items.some(v => !methods.has(v.method)))
      return Response.json({ jsonrpc: "2.0", id: Array.isArray(body) ? null : body.id, error: { code: -32601, message: "Method unavailable" } }, { headers });
    const response = await fetch(chainManifest().rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), cache: "no-store"
    });
    return Response.json(await response.json(), { headers });
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request unavailable" } }, { status: 400, headers });
  }
}
