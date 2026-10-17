import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { businessRpc, pathId } from "@/lib/products-server";
import type { Claim } from "@/lib/types";
import { requireDatabaseProducts } from "@/lib/chain/products-server";

export const POST = route(async (request) => {
  const { db, userId } = await requireAuth({ roles: ["service_center"] });
  requireDatabaseProducts();
  const input = await readJson(
    request,
    z
      .object({
        action: z.enum(["approve", "reject", "complete"]),
        reason: z.string().trim().min(1).max(2000).optional(),
        resolution: z.string().trim().min(1).max(2000).optional(),
      })
      .strict(),
  );
  return Response.json({
    data: await businessRpc<Claim>(db, "dapp_claim_action", {
      p_actor_id: userId,
      p_claim_id: pathId(request, "claims"),
      p_action: input.action,
      p_reason: input.reason || null,
      p_resolution: input.resolution || null,
    }),
  });
});
