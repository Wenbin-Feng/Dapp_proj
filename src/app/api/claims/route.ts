import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { businessRpc, relatedClaims } from "@/lib/products-server";
import type { Claim } from "@/lib/types";

export const GET = route(async () => {
  const { db, userId } = await requireAuth();
  return Response.json({ data: await relatedClaims(db, userId) });
});

export const POST = route(async (request) => {
  const { db, userId } = await requireAuth({ roles: ["customer"] });
  const input = await readJson(
    request,
    z
      .object({
        product_id: z.uuid(),
        service_center_id: z.uuid(),
        description: z.string().trim().min(1).max(2000),
      })
      .strict(),
  );
  return Response.json(
    {
      data: await businessRpc<Claim>(db, "dapp_submit_claim", {
        p_actor_id: userId,
        p_product_id: input.product_id,
        p_service_center_id: input.service_center_id,
        p_description: input.description,
      }),
    },
    { status: 201 },
  );
});
