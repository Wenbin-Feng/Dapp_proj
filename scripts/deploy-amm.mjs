import { erc20Abi, parseEther, zeroAddress, getAddress } from "viem";
import { deploymentContext } from "./deployment.mjs";
import {
  factoryBuild,
  pairBuild,
  routerBuild,
  wethBuild,
  expectedPair,
} from "./uniswap.mjs";

const d = await deploymentContext();
if (!d.manifest.pdc || !d.manifest.pdq)
  throw new Error("Deploy the demo tokens first");
const factory = {
  address: await d.deploy("factory", factoryBuild, [d.manifest.treasury]),
  abi: factoryBuild.abi,
};
const weth = await d.deploy("weth", wethBuild);
const router = {
  address: await d.deploy("router", routerBuild, [factory.address, weth]),
  abi: routerBuild.abi,
};
if (
  getAddress(
    await d.client.readContract({ ...router, functionName: "factory" }),
  ) !== getAddress(factory.address) ||
  getAddress(
    await d.client.readContract({ ...router, functionName: "WETH" }),
  ) !== getAddress(weth)
)
  throw new Error("Router configuration mismatch");
if (
  (await d.client.readContract({ ...factory, functionName: "feeTo" })) !==
  zeroAddress
)
  throw new Error("Protocol fee must be off");
const args = [d.manifest.pdc, d.manifest.pdq];
let pair = await d.client.readContract({
  ...factory,
  functionName: "getPair",
  args,
});
if (pair === zeroAddress) {
  await d.send("create-pair", factory, "createPair", args);
  pair = await d.client.readContract({
    ...factory,
    functionName: "getPair",
    args,
  });
}
if (getAddress(pair) !== expectedPair(factory.address, ...args))
  throw new Error("Factory and Router pair address mismatch");
d.manifest.pair = pair;
await d.save();
const pairContract = { address: pair, abi: pairBuild.abi };
if (
  !d.manifest.steps["seed-pool"] &&
  (await d.client.readContract({
    ...pairContract,
    functionName: "totalSupply",
  })) !== 0n
)
  throw new Error(
    "Pool was funded outside this deployment journal; inspect it before seeding",
  );
if (!d.manifest.steps["seed-pool"]) {
  for (const key of ["pdc", "pdq"])
    await d.send(
      `seed-approve-${key}`,
      { address: d.manifest[key], abi: erc20Abi },
      "approve",
      [router.address, parseEther("100000")],
    );
  await d.send("seed-pool", router, "addLiquidity", [
    ...args,
    parseEther("100000"),
    parseEther("100000"),
    parseEther("100000"),
    parseEther("100000"),
    d.manifest.treasury,
    (await d.client.getBlock()).timestamp + 600n,
  ]);
} else {
  await d.send("seed-pool", router, "addLiquidity", []);
}
const quote = await d.client.readContract({
  ...router,
  functionName: "getAmountsOut",
  args: [parseEther("1"), args],
});
if (quote[1] <= 0n) throw new Error("Router cannot quote the configured pair");
console.log(
  `AMM configured at ${pair}. Core bytecode hash and Router/Factory address agreement verified. Protocol fee off.`,
);
