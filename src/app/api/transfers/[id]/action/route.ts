import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { businessRpc, pathId } from "@/lib/products-server";
import type { Transfer } from "@/lib/types";

export const POST = route(async (request) => {
  const { db, userId } = await requireAuth();
  const input = await readJson(
    request,
    z.object({ action: z.enum(["accept", "reject", "cancel"]) }).strict(),
  );
  return Response.json({
    data: await businessRpc<Transfer>(db, "dapp_transfer_action", {
      p_actor_id: userId,
      p_transfer_id: pathId(request, "transfers"),
      p_action: input.action,
    }),
  });
});
