import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
const [address, name] = process.argv.slice(2);
const roles = { manufacturer: 1, retailer: 2, customer: 3, service_center: 4 };
if (!address || !roles[name])
  throw Error(
    "Usage: npm run chain:grant -- 0xWallet manufacturer|retailer|customer|service_center",
  );
const d = JSON.parse(
  await readFile(
    process.env.CHAIN_DEPLOYMENT_FILE || "data/chain/deployment.json",
    "utf8",
  ),
);
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(d.rpcUrl).hostname))
  throw Error("Local node only.");
const provider = new JsonRpcProvider(d.rpcUrl, undefined, { cacheTimeout: -1 });
try {
  if (Number((await provider.getNetwork()).chainId) !== d.chainId)
    throw Error("Wrong network");
  const c = new Contract(
    d.address,
    [
      "function grantRole(address,uint8)",
      "function deploymentId() view returns (bytes32)",
    ],
    await provider.getSigner(d.administrator),
  );
  if ((await c.deploymentId()) !== d.deploymentId)
    throw Error("Deployment changed");
  const r = await (await c.grantRole(getAddress(address), roles[name])).wait();
  console.log(`Granted ${name}; transaction ${r.hash}`);
} finally {
  provider.destroy();
}
