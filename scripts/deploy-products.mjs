import { getAddress } from "viem";
import { deploymentContext, ownArtifact } from "./deployment.mjs";
const d = await deploymentContext();
if (!d.manifest.pdc) throw new Error("Deploy PDC first");
const build = await ownArtifact("DemoProducts");
const products = await d.deploy("products", build, [d.manifest.pdc]);
const receipt = await d.client.getTransactionReceipt({
  hash: d.manifest.steps["deploy-products"],
});
d.manifest.productsFromBlock = receipt.blockNumber.toString();
await d.save();
const token = await d.client.readContract({
  address: products,
  abi: build.abi,
  functionName: "paymentToken",
});
if (getAddress(token) !== getAddress(d.manifest.pdc))
  throw new Error("Product payment token mismatch");
console.log(
  `Product registry ${products}; PDC ${token}. Product backend is still controlled separately by website configuration.`,
);
