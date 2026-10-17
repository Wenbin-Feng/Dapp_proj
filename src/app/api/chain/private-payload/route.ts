import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { ApiError, readJson, route } from "@/lib/http";
import { productConfiguration } from "@/lib/chain/products-server";
import { demoPublicClient } from "@/lib/chain/server";
import {
  checkProductDeployment,
  chainDatabaseError,
} from "@/lib/chain/product-indexer";
import { productAbi } from "@/lib/chain/product-abi";
import { productHex } from "@/lib/chain/product-events";
import {
  payloadCommitment,
  type PrivatePayload,
} from "@/lib/chain/private-payload";
import type { Hex } from "viem";

export const POST = route(async (request) => {
  const { db, walletAddress, profile } = await requireAuth();
  const input = await readJson(
    request,
    z
      .object({
        product_id: z.uuidv4(),
        claim_id: z.uuidv4(),
        kind: z.enum(["description", "reason", "resolution"]),
        body: z.string().trim().min(1).max(2000),
      })
      .strict(),
  );
  const config = await productConfiguration();
  const client = demoPublicClient(config);
  await checkProductDeployment(client, config);
  if (input.kind === "description") {
    const product = await client.readContract({
      address: config.products,
      abi: productAbi,
      functionName: "getProduct",
      args: [productHex(input.product_id)],
    });
    if (
      profile?.role !== "customer" ||
      product.owner.toLowerCase() !== walletAddress
    )
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Only the current customer owner can prepare a service request.",
      );
  } else {
    const claim = await client.readContract({
      address: config.products,
      abi: productAbi,
      functionName: "getClaim",
      args: [productHex(input.claim_id)],
    });
    if (
      profile?.role !== "service_center" ||
      claim.center.toLowerCase() !== walletAddress ||
      claim.productId !== productHex(input.product_id) ||
      (input.kind === "reason" ? claim.status !== 1 : claim.status !== 2)
    )
      throw new ApiError(
        403,
        "FORBIDDEN",
        "This claim is not available for your service center to update.",
      );
  }
  const payload: Omit<PrivatePayload, "commitment"> = {
    ...input,
    chain_id: config.chainId,
    contract_address: config.products.toLowerCase(),
    author_wallet: walletAddress,
    nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
  const commitment = payloadCommitment(payload);
  const saved = await db
    .from("dapp_demo_private_payloads")
    .insert({ ...payload, commitment });
  if (saved.error) chainDatabaseError(saved.error);
  return Response.json({ data: { commitment } }, { status: 201 });
});
