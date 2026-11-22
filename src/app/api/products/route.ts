import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";

export const GET = route(async (request) => {
  const { db, userId } = await requireAuth(request);
  return Response.json({ data: db.ownedProducts(userId) });
});
export const POST = route(async (request) => {
  const { db, userId } = await requireAuth(request, {
    roles: ["manufacturer"],
  });
  const input = await readJson(
    request,
    z
      .object({
        serial_number: z.string().trim().min(1).max(120),
        model: z.string().trim().min(1).max(120),
        manufacturer_name: z.string().trim().min(1).max(120).optional(),
        warranty_duration_days: z.number().int().min(1).max(36500),
        max_claims: z.number().int().min(1).max(1000),
      })
      .strict(),
  );
  return Response.json({ data: db.register(userId, input) }, { status: 201 });
});
