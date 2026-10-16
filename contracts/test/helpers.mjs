import { readFile } from "node:fs/promises";
import { network } from "hardhat";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
} from "viem";

export async function artifact(name) {
  return JSON.parse(
    await readFile(
      new URL(
        `../../artifacts/contracts/${name}.sol/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

export async function fixture() {
  const connection = await network.create("hardhat");
  const chain = defineChain({
    id: 31337,
    name: "Hardhat",
    nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://localhost:8545"] } },
  });
  const transport = custom(connection.provider);
  const client = createPublicClient({ chain, transport });
  const accounts = await connection.provider.request({
    method: "eth_accounts",
  });
  const wallets = accounts.map((account) =>
    createWalletClient({ account, chain, transport }),
  );
  const send = async (wallet, contract, functionName, args = []) => {
    const { request } = await client.simulateContract({
      ...contract,
      functionName,
      args,
      account: wallet.account,
    });
    const receipt = await client.waitForTransactionReceipt({
      hash: await wallet.writeContract(request),
    });
    if (receipt.status !== "success") throw new Error("Transaction reverted");
    return receipt;
  };
  const deploy = async (build, args = []) => {
    const receipt = await client.waitForTransactionReceipt({
      hash: await wallets[0].deployContract({
        abi: build.abi,
        bytecode: build.bytecode.startsWith("0x")
          ? build.bytecode
          : `0x${build.bytecode}`,
        args,
      }),
    });
    if (!receipt.contractAddress || receipt.status !== "success")
      throw new Error("Deployment failed");
    return { address: receipt.contractAddress, abi: build.abi };
  };
  return {
    connection,
    client,
    accounts,
    wallets,
    send,
    deploy,
    read: (contract, functionName, args = []) =>
      client.readContract({ ...contract, functionName, args }),
  };
}
