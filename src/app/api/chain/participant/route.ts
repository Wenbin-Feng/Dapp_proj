import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { ApiError, route } from "@/lib/http";
import { productConfiguration } from "@/lib/chain/products-server";
import { demoPublicClient } from "@/lib/chain/server";
import { productAbi } from "@/lib/chain/product-abi";
import { chainDatabaseError } from "@/lib/chain/product-indexer";
import type { Address } from "viem";
import { chainRoles } from "@/lib/chain/config";
import type { Role } from "@/lib/types";

export const GET = route(async (request) => {
  const { db } = await requireAuth();
  const params = new URL(request.url).searchParams;
  const wallet = params.get("wallet");
  const id = params.get("id");
  if (
    !!wallet === !!id ||
    (wallet && !/^0x[0-9a-fA-F]{40}$/.test(wallet)) ||
    (id && !z.uuid().safeParse(id).success)
  )
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "Provide one wallet address or profile ID.",
    );
  let query = db.from("dapp_profiles").select("id,wallet_address,role");
  query = wallet
    ? query.eq("wallet_address", wallet.toLowerCase())
    : query.eq("id", id!);
  const result = await query.maybeSingle();
  if (result.error) chainDatabaseError(result.error);
  if (!result.data)
    throw new ApiError(
      404,
      "PARTICIPANT_REQUIRED",
      "The recipient needs to complete their website profile first.",
    );
  const config = await productConfiguration();
  const role = await demoPublicClient(config).readContract({
    address: config.products,
    abi: productAbi,
    functionName: "roles",
    args: [result.data.wallet_address as Address],
  });
  if (role === 0)
    throw new ApiError(
      409,
      "CHAIN_ROLE_REQUIRED",
      "The recipient needs to activate their test-network role in the workspace first.",
    );
  if (role !== chainRoles[result.data.role as Role])
    throw new ApiError(
      409,
      "CHAIN_ROLE_MISMATCH",
      "The recipient's chain role differs from their website profile. Use a wallet with matching roles.",
    );
  return Response.json({ data: { ...result.data, chain_role: role } });
});
