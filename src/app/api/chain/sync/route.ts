import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getAdmin } from "@/lib/supabase/admin";
import { readJson, route } from "@/lib/http";
import { productConfiguration } from "@/lib/chain/products-server";
import { demoPublicClient } from "@/lib/chain/server";
import { syncProductIndex } from "@/lib/chain/product-indexer";
import type { Hash } from "viem";

export const maxDuration = 60;
export const POST = route(async (request) => {
  const token = process.env.DEMO_INDEXER_TOKEN;
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const indexer =
    !!token &&
    token.length >= 32 &&
    Buffer.byteLength(token) === Buffer.byteLength(supplied) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(supplied));
  const db = indexer ? getAdmin() : (await requireAuth()).db;
  const input = await readJson(
    request,
    z
      .object({
        transaction_hash: z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .optional(),
      })
      .strict(),
  );
  const config = await productConfiguration();
  const result = await syncProductIndex(
    demoPublicClient(config),
    db,
    config,
    input.transaction_hash?.toLowerCase() as Hash | undefined,
  );
  return Response.json({ data: result });
});
