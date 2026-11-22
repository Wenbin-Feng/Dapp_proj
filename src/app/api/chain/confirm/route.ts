import { z } from "zod";
import { route, readJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { requireChainMode } from "@/lib/chain-config";
import { completeTransaction } from "@/lib/chain-server";
export const POST = route(async (request) => {
  requireChainMode();
  const { db, userId } = await requireAuth(request);
  const input = await readJson(
    request,
    z
      .object({
        id: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        hash: z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .optional(),
      })
      .strict(),
  );
  return Response.json({
    data: await completeTransaction(db, userId, input.id, input.hash),
  });
});
