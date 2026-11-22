import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  keccak256,
  randomBytes,
  hexlify,
} from "ethers";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const chainId = Number(process.env.DAPP_CHAIN_ID || 31337);
if (![31337, 31338].includes(chainId)) throw Error("Expected a DApp demo chain ID.");
const rpcUrl = process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname))
  throw Error("This deployment script only supports a local development node.");
const file = resolve(
  process.env.CHAIN_DEPLOYMENT_FILE || "data/chain/deployment.json",
);
const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
try {
  if ((await provider.getNetwork()).chainId !== BigInt(chainId))
    throw Error("Expected local chain ID 31337.");
  const previous = await readFile(file, "utf8")
    .then(JSON.parse)
    .catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
  if (previous && !process.argv.includes("--new")) {
    try {
      const c = new Contract(
        previous.address,
        ["function deploymentId() view returns (bytes32)"],
        provider,
      );
      if ((await c.deploymentId()) === previous.deploymentId) {
        console.log(`Deployment already active at ${previous.address}.`);
        process.exitCode = 0;
      } else throw Error("Deployment identity changed");
    } catch {
      throw Error(
        "The saved deployment is missing or belongs to a reset chain. Use chain:deploy -- --new for a NEW isolated SQLite projection; old data is retained.",
      );
    }
  } else {
    const artifact = JSON.parse(
      await readFile("chain/artifacts/ProductPassport.json", "utf8"),
    );
    const signer = await provider.getSigner(0),
      deploymentId = hexlify(randomBytes(32));
    const contract = await new ContractFactory(
      artifact.abi,
      artifact.bytecode,
      signer,
    ).deploy(deploymentId);
    const receipt = await contract.deploymentTransaction().wait();
    const address = await contract.getAddress();
    // Five funded Hardhat test accounts; administrator remains a separate identity.
    const accounts = [];
    for (const [i, role] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 3],
      [5, 4],
    ]) {
      const account = await provider.getSigner(i);
      const wallet = await account.getAddress();
      await (await contract.grantRole(wallet, role)).wait();
      accounts.push({
        index: i,
        address: wallet,
        role: [
          "none",
          "manufacturer",
          "retailer",
          "customer",
          "service_center",
        ][role],
      });
    }
    const data = {
      version: 1,
      chainId,
      rpcUrl,
      address,
      deploymentId,
      codeHash: keccak256(await provider.getCode(address)),
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      transactionHash: receipt.hash,
      databasePath: resolve(
        dirname(file),
        `passport-${deploymentId.slice(2, 18)}.sqlite`,
      ),
      administrator: await signer.getAddress(),
      accounts,
    };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file + ".tmp", JSON.stringify(data, null, 2) + "\n");
    const { rename } = await import("node:fs/promises");
    await rename(file + ".tmp", file);
    console.log(
      JSON.stringify(
        {
          address,
          chainId,
          manifest: file,
          sqlite: data.databasePath,
          accounts,
        },
        null,
        2,
      ),
    );
  }
} finally {
  provider.destroy();
}
