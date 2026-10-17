import {
  erc20Abi,
  parseAbi,
  getAddress,
  type Address,
  type createPublicClient,
} from "viem";
import type { DemoConfig } from "./config";
export const routerAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
  "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)",
]);
export const pairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);
const factoryAbi = parseAbi([
  "function getPair(address,address) view returns (address)",
  "function feeTo() view returns (address)",
]);
export type Pool = {
  reservePdc: bigint;
  reservePdq: bigint;
  totalSupply: bigint;
  lpBalance: bigint;
  lpAllowance: bigint;
  timestamp: bigint;
  blockNumber: bigint;
};

export async function readPool(
  client: ReturnType<typeof createPublicClient>,
  config: DemoConfig,
  account: Address,
): Promise<Pool> {
  if (!config.factory || !config.router || !config.pair || !config.weth)
    throw new Error("The team has not deployed the AMM pool yet.");
  const block = await client.getBlock();
  const blockNumber = block.number;
  const [
    factoryPair,
    routerFactory,
    weth,
    feeTo,
    token0,
    token1,
    reserves,
    totalSupply,
    lpBalance,
    lpAllowance,
  ] = await Promise.all([
    client.readContract({
      address: config.factory,
      abi: factoryAbi,
      functionName: "getPair",
      args: [config.pdc, config.pdq],
      blockNumber,
    }),
    client.readContract({
      address: config.router,
      abi: routerAbi,
      functionName: "factory",
      blockNumber,
    }),
    client.readContract({
      address: config.router,
      abi: routerAbi,
      functionName: "WETH",
      blockNumber,
    }),
    client.readContract({
      address: config.factory,
      abi: factoryAbi,
      functionName: "feeTo",
      blockNumber,
    }),
    client.readContract({
      address: config.pair,
      abi: pairAbi,
      functionName: "token0",
      blockNumber,
    }),
    client.readContract({
      address: config.pair,
      abi: pairAbi,
      functionName: "token1",
      blockNumber,
    }),
    client.readContract({
      address: config.pair,
      abi: pairAbi,
      functionName: "getReserves",
      blockNumber,
    }),
    client.readContract({
      address: config.pair,
      abi: erc20Abi,
      functionName: "totalSupply",
      blockNumber,
    }),
    client.readContract({
      address: config.pair,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: config.pair,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, config.router],
      blockNumber,
    }),
  ]);
  if (
    getAddress(factoryPair) !== config.pair ||
    getAddress(routerFactory) !== config.factory ||
    getAddress(weth) !== config.weth ||
    BigInt(feeTo) !== 0n ||
    getAddress(token0) === getAddress(token1) ||
    new Set([getAddress(token0), getAddress(token1), config.pdc, config.pdq])
      .size !== 2
  )
    throw new Error(
      "Pool deployment addresses do not match. Contact the team.",
    );
  const [reservePdc, reservePdq] =
    getAddress(token0) === config.pdc ? reserves : [reserves[1], reserves[0]];
  if (reservePdc === 0n || reservePdq === 0n || totalSupply === 0n)
    throw new Error(
      "The pool has no liquidity. Ask the team to initialize it.",
    );
  return {
    reservePdc,
    reservePdq,
    totalSupply,
    lpBalance,
    lpAllowance,
    timestamp: block.timestamp,
    blockNumber,
  };
}

export function amountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n)
    throw new Error("The amount and both reserves must be positive.");
  return (amountIn * 997n * reserveOut) / (reserveIn * 1000n + amountIn * 997n);
}
export function priceImpactBps(
  input: bigint,
  output: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
) {
  const spot = (input * 997n * reserveOut) / (1000n * reserveIn);
  return spot ? ((spot - output) * 10000n) / spot : 0n;
}
export function displayBps(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}%`;
}
