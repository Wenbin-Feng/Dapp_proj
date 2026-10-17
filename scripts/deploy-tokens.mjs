import { erc20Abi, parseEther } from "viem";
import { deploymentContext, ownArtifact } from "./deployment.mjs";

const d = await deploymentContext();
const build = await ownArtifact("DemoToken");
for (const [key, name, symbol] of [
  ["pdc", "Passport Demo Coin", "PDC"],
  ["pdq", "Passport Demo Quote", "PDQ"],
]) {
  const address = await d.deploy(key, build, [
    name,
    symbol,
    d.manifest.treasury,
  ]);
  const token = { address, abi: erc20Abi };
  if (
    (await d.client.readContract({ ...token, functionName: "totalSupply" })) !==
    parseEther("1000000")
  )
    throw new Error("Supply mismatch");
  for (const recipient of d.manifest.demoWallets)
    await d.send(`distribute-${key}-${recipient}`, token, "transfer", [
      recipient,
      parseEther("10000"),
    ]);
}
console.log(
  `Token deployment saved to ${d.file.pathname}. Re-running resumes the saved journal without minting again.`,
);
console.log(
  JSON.stringify(
    {
      chainId: d.manifest.chainId,
      treasury: d.manifest.treasury,
      pdc: d.manifest.pdc,
      pdq: d.manifest.pdq,
      fromBlock: d.manifest.fromBlock,
    },
    null,
    2,
  ),
);
