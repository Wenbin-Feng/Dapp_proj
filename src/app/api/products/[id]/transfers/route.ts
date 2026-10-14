import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { businessRpc, pathId } from "@/lib/products-server";
import type { Transfer } from "@/lib/types";

export const POST = route(async (request) => {
  const { db, userId } = await requireAuth({
    roles: ["manufacturer", "retailer", "customer"],
  });
  const input = await readJson(
    request,
    z
      .object({
        to_wallet: z
          .string()
          .trim()
          .regex(/^0x[0-9a-fA-F]{40}$/)
          .transform((value) => value.toLowerCase()),
      })
      .strict(),
  );
  return Response.json({
    data: await businessRpc<Transfer>(db, "dapp_request_transfer", {
      p_actor_id: userId,
      p_product_id: pathId(request, "products"),
      p_to_wallet: input.to_wallet,
    }),
  });
});
