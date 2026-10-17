import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { businessRpc, ownedProducts } from "@/lib/products-server";
import type { Product } from "@/lib/types";
import { requireDatabaseProducts } from "@/lib/chain/products-server";

const registerSchema = z
  .object({
    serial_number: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    warranty_duration_days: z.number().int().min(1).max(36500),
    max_claims: z.number().int().min(1).max(1000),
  })
  .strict();

export const GET = route(async () => {
  const { db, userId } = await requireAuth();
  return Response.json({ data: await ownedProducts(db, userId) });
});

export const POST = route(async (request) => {
  const { db, userId } = await requireAuth({ roles: ["manufacturer"] });
  requireDatabaseProducts();
  const input = await readJson(request, registerSchema);
  const product = await businessRpc<Product>(db, "dapp_register_product", {
    p_actor_id: userId,
    p_serial_number: input.serial_number,
    p_model: input.model,
    p_warranty_duration_days: input.warranty_duration_days,
    p_max_claims: input.max_claims,
  });
  return Response.json({ data: product }, { status: 201 });
});
