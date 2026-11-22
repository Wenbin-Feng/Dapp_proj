import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, getAddress, parseEther } from "ethers";
const [address] = process.argv.slice(2);
if (!address)
  throw Error("Usage: npm run chain:fund -- 0xWallet (sends 2 local test ETH)");
const target = getAddress(address);
const d = JSON.parse(
  await readFile(
    process.env.CHAIN_DEPLOYMENT_FILE || "data/chain/deployment.json",
    "utf8",
  ),
);
const endpoint = new URL(d.rpcUrl);
if (
  endpoint.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
)
  throw Error("Local node only.");
const provider = new JsonRpcProvider(endpoint.href, undefined, {
  cacheTimeout: -1,
});
try {
  if ((await provider.getNetwork()).chainId !== BigInt(d.chainId))
    throw Error("Wrong demo network.");
  const contract = new Contract(
    d.address,
    ["function deploymentId() view returns(bytes32)"],
    provider,
  );
  if ((await contract.deploymentId()) !== d.deploymentId)
    throw Error("Deployment changed; deploy a new local instance first.");
  const tx = await (
    await provider.getSigner(d.administrator)
  ).sendTransaction({ to: target, value: parseEther("2") });
  await tx.wait();
  console.log(`Sent 2 local test ETH to ${target}; transaction ${tx.hash}`);
} finally {
  provider.destroy();
}
