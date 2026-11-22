import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";

export const GET = route(async (request) => {
  const { db, userId } = await requireAuth(request);
  return Response.json({ data: db.claims(userId) });
});
export const POST = route(async (request) => {
  const { db, userId } = await requireAuth(request, { roles: ["customer"] });
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
      data: db.submitClaim(
        userId,
        input.product_id,
        input.service_center_id,
        input.description,
      ),
    },
    { status: 201 },
  );
});
