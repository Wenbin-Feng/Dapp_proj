import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { pathId } from "@/lib/products-server";
export const POST = route(async (request) => {
  const { db, userId } = await requireAuth(request, {
    roles: ["service_center"],
  });
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
    data: db.claimAction(
      userId,
      pathId(request, "claims"),
      input.action,
      input.reason,
      input.resolution,
    ),
  });
});
