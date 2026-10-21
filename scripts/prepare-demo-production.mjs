import { appendFile, readFile } from "node:fs/promises";
import { deploymentSchema } from "../src/lib/chain/config.ts";

const source = JSON.parse(
  await readFile(new URL("../config/demo-chain.sepolia.json", import.meta.url), "utf8"),
);
const deployment = deploymentSchema.parse(source);
if (
  deployment.chainId !== 11155111 ||
  !["factory", "router", "pair", "weth", "products", "productsFromBlock"].every(
    (field) => deployment[field],
  )
)
  throw new Error("A complete Sepolia deployment is required for production");
const rpc = new URL(source.rpcUrl);
if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash)
  throw new Error("Use a public HTTPS RPC without credentials or fragments");
const backend = process.env.PRODUCT_BACKEND || "database";
if (!["database", "chain"].includes(backend))
  throw new Error("PRODUCT_BACKEND must be database or chain");
if (!process.env.GITHUB_ENV)
  throw new Error("Run this script in GitHub Actions after vercel pull");

const values = {
  DEMO_DEPLOYMENT: JSON.stringify(deployment),
  DEMO_PUBLIC_RPC_URL: rpc.href,
  PRODUCT_BACKEND: backend,
};
const text = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
// Append only public settings; keep the production Supabase configuration pulled by Vercel.
await appendFile(".vercel/.env.production.local", "\n" + text);
await appendFile(process.env.GITHUB_ENV, text);
console.log(`Sepolia demo configured; product backend: ${backend}`);
