import { createRequire } from "node:module";
import { getCreate2Address, keccak256, encodePacked, getAddress } from "viem";

const require = createRequire(import.meta.url);
export const factoryBuild = require("@uniswap/v2-core/build/UniswapV2Factory.json");
export const pairBuild = require("@uniswap/v2-core/build/UniswapV2Pair.json");
export const routerBuild = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");
export const wethBuild = require("@uniswap/v2-periphery/build/WETH9.json");
export const INIT_CODE_HASH =
  "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f";
const bytecode = (build) =>
  build.bytecode.startsWith("0x") ? build.bytecode : `0x${build.bytecode}`;

export function expectedPair(factory, a, b) {
  if (
    keccak256(bytecode(pairBuild)) !== INIT_CODE_HASH ||
    !bytecode(routerBuild).includes(INIT_CODE_HASH.slice(2))
  )
    throw new Error("Uniswap core/periphery build mismatch");
  const [token0, token1] = [a, b].sort((left, right) =>
    left.toLowerCase().localeCompare(right.toLowerCase()),
  );
  return getAddress(
    getCreate2Address({
      from: factory,
      salt: keccak256(encodePacked(["address", "address"], [token0, token1])),
      bytecodeHash: INIT_CODE_HASH,
    }),
  );
}
