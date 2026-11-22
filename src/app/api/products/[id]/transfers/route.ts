import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { pathId } from "@/lib/products-server";
export const POST = route(async (request) => {
  const { db, userId } = await requireAuth(request, {
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
          .transform((v) => v.toLowerCase()),
      })
      .strict(),
  );
  return Response.json({
    data: db.requestTransfer(
      userId,
      pathId(request, "products"),
      input.to_wallet,
    ),
  });
});
