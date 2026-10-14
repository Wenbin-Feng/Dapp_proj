import { requireAuth } from "@/lib/auth";
import { route } from "@/lib/http";
import { dashboard } from "@/lib/products-server";

export const GET = route(async () => {
  const { db, userId } = await requireAuth();
  return Response.json({ data: await dashboard(db, userId) });
});
