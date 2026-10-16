import "server-only";
import { readFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { demoChain, deploymentSchema, type DemoConfig } from "./config";

export async function getDemoConfig(): Promise<DemoConfig | null> {
  let source = process.env.DEMO_DEPLOYMENT;
  // Local journals are not shipped to Vercel. Sepolia uses a reviewed manifest in environment configuration.
  if (
    !source &&
    process.env.DEMO_DEPLOYMENT_FILE &&
    process.env.NODE_ENV !== "production"
  )
    source = await readFile(process.env.DEMO_DEPLOYMENT_FILE, "utf8");
  if (!source) {
    if (process.env.PRODUCT_BACKEND === "chain")
      throw new Error(
        "Configure the product deployment before enabling chain mode",
      );
    return null;
  }
  const deployment = deploymentSchema.parse(JSON.parse(source));
  const rpcUrl =
    process.env.DEMO_PUBLIC_RPC_URL ||
    (deployment.chainId === 31337 ? "http://127.0.0.1:8545" : "");
  const url = new URL(rpcUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (deployment.chainId === 11155111 && url.protocol !== "https:")
  )
    throw new Error(
      "Configure a public test-network RPC URL without credentials",
    );
  const productBackend =
    process.env.PRODUCT_BACKEND === "chain" ? "chain" : "database";
  if (productBackend === "chain" && !deployment.products)
    throw new Error("Product contract is required for chain mode");
  return { ...deployment, rpcUrl, productBackend };
}

export function demoPublicClient(config: DemoConfig) {
  return createPublicClient({
    chain: demoChain(config),
    transport: http(process.env.DEMO_RPC_URL || config.rpcUrl),
  });
}
