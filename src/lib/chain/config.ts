import {
  defineChain,
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";
export const chainRoles = {
  manufacturer: 1,
  retailer: 2,
  customer: 3,
  service_center: 4,
} as const;

const address = z
  .string()
  .refine(
    (value) =>
      isAddress(value, { strict: false }) &&
      value.toLowerCase() !== zeroAddress,
  )
  .transform((value) => getAddress(value));
export const deploymentSchema = z
  .object({
    version: z.literal("demo-v1"),
    chainId: z.union([z.literal(31337), z.literal(11155111)]),
    treasury: address,
    pdc: address,
    pdq: address,
    fromBlock: z.string().regex(/^\d+$/),
    factory: address.optional(),
    router: address.optional(),
    pair: address.optional(),
    weth: address.optional(),
    products: address.optional(),
    productsFromBlock: z.string().regex(/^\d+$/).optional(),
  })
  .refine((value) => {
    const contracts = [
      value.pdc,
      value.pdq,
      value.factory,
      value.router,
      value.pair,
      value.weth,
      value.products,
    ].filter(Boolean);
    return new Set(contracts).size === contracts.length;
  }, "Contract addresses must be distinct");

export type DemoDeployment = z.infer<typeof deploymentSchema>;
export type DemoConfig = DemoDeployment & {
  rpcUrl: string;
  productBackend: "database" | "chain";
};
export type DemoSymbol = "PDC" | "PDQ";

export function demoChain(config: Pick<DemoConfig, "chainId" | "rpcUrl">) {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 31337 ? "Hardhat local" : "Sepolia",
    nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    ...(config.chainId === 11155111
      ? {
          blockExplorers: {
            default: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
          },
        }
      : {}),
  });
}

export function tokenAddress(config: DemoConfig, symbol: DemoSymbol): Address {
  return symbol === "PDC" ? config.pdc : config.pdq;
}
