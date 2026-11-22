import { z } from "zod";
import { getDatabase } from "@/lib/database";
import { ApiError, route } from "@/lib/http";
import { syncChain, productChainProof } from "@/lib/chain-server";
export const GET = route(async (request) => {
  const parsed = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .safeParse(new URL(request.url).searchParams.get("query"));
  if (!parsed.success)
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "Enter a product ID or serial number.",
    );
  const db = getDatabase();
  await syncChain(db);
  const product = db.publicProduct(parsed.data);
  return Response.json({
    data: { ...product, chain: productChainProof(db, product.id) },
  });
});
