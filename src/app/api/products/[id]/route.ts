import { requireAuth } from "@/lib/auth";
import { route } from "@/lib/http";
import { pathId, productDetail } from "@/lib/products-server";

export const GET = route(async (request) => {
  const { db, userId } = await requireAuth();
  return Response.json({
    data: await productDetail(db, userId, pathId(request, "products")),
  });
});
