import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export async function deploymentContext() {
  const chainId = Number(process.env.DEMO_CHAIN_ID || "31337");
  if (![31337, 11155111].includes(chainId))
    throw new Error("Only Hardhat and Sepolia are supported");
  const rpcUrl =
    process.env.DEMO_RPC_URL ||
    (chainId === 31337 ? "http://127.0.0.1:8545" : "");
  if (!rpcUrl) throw new Error("Set DEMO_RPC_URL for Sepolia");
  const chain = defineChain({
    id: chainId,
    name: chainId === 31337 ? "Hardhat local" : "Sepolia",
    nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  if ((await client.getChainId()) !== chainId)
    throw new Error("RPC chain ID mismatch");
  const accounts =
    chainId === 31337 ? await client.request({ method: "eth_accounts" }) : [];
  const account = process.env.DEMO_DEPLOYER_PRIVATE_KEY
    ? privateKeyToAccount(process.env.DEMO_DEPLOYER_PRIVATE_KEY)
    : accounts[0];
  if (!account)
    throw new Error(
      "Set DEMO_DEPLOYER_PRIVATE_KEY in your local environment, never in source control",
    );
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const treasury = getAddress(
    process.env.DEMO_TREASURY || wallet.account.address,
  );
  if (treasury !== getAddress(wallet.account.address))
    throw new Error("This setup script must be signed by the test treasury");
  const recipients = (
    process.env.DEMO_WALLETS?.split(",") || accounts.slice(1, 6)
  ).map((v) => getAddress(v.trim()));
  if (recipients.length !== 5 || new Set([treasury, ...recipients]).size !== 6)
    throw new Error(
      "Provide exactly five distinct DEMO_WALLETS, excluding the treasury",
    );
  const file = new URL(`../deployments/${chainId}.json`, import.meta.url);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  manifest ||= {
    version: "demo-v1",
    chainId,
    treasury,
    demoWallets: recipients,
    fromBlock: (await client.getBlockNumber()).toString(),
    steps: {},
  };
  if (
    manifest.chainId !== chainId ||
    getAddress(manifest.treasury) !== treasury ||
    JSON.stringify(manifest.demoWallets) !== JSON.stringify(recipients)
  )
    throw new Error("Deployment configuration differs from the saved journal");
  const save = async () => {
    await mkdir(new URL("../deployments/", import.meta.url), {
      recursive: true,
    });
    await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
  };
  const transaction = async (key, submit) => {
    if (!manifest.steps[key]) {
      manifest.steps[key] = await submit();
      await save();
    }
    const receipt = await client.waitForTransactionReceipt({
      hash: manifest.steps[key],
    });
    if (receipt.status !== "success")
      throw new Error(`Saved step ${key} reverted; inspect it before retrying`);
    return receipt;
  };
  const deploy = async (key, build, args = []) => {
    if (manifest[key]) {
      if (!(await client.getCode({ address: manifest[key] })))
        throw new Error(
          `No code at saved ${key}; local node may have reset. Archive the local deployment journal before a fresh local deployment.`,
        );
      return manifest[key];
    }
    const receipt = await transaction(`deploy-${key}`, () =>
      wallet.deployContract({
        abi: build.abi,
        bytecode: build.bytecode.startsWith("0x")
          ? build.bytecode
          : `0x${build.bytecode}`,
        args,
      }),
    );
    if (!receipt.contractAddress)
      throw new Error(`No contract address for ${key}`);
    manifest[key] = receipt.contractAddress;
    await save();
    return receipt.contractAddress;
  };
  const send = async (key, contract, functionName, args = []) =>
    transaction(key, async () => {
      const { request } = await client.simulateContract({
        ...contract,
        functionName,
        args,
        account: wallet.account,
      });
      return wallet.writeContract(request);
    });
  return { client, wallet, manifest, file, save, deploy, send };
}

export async function ownArtifact(name) {
  return JSON.parse(
    await readFile(
      new URL(
        `../artifacts/contracts/${name}.sol/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}
