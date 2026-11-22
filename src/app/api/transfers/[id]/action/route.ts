import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { pathId } from "@/lib/products-server";
export const POST = route(async (request) => {
  const { db, userId } = await requireAuth(request);
  const input = await readJson(
    request,
    z.object({ action: z.enum(["accept", "reject", "cancel"]) }).strict(),
  );
  return Response.json({
    data: db.transferAction(userId, pathId(request, "transfers"), input.action),
  });
});
