import { requireAuth } from "@/lib/auth";
import { route } from "@/lib/http";
import { pathId } from "@/lib/products-server";
import { productChainProof } from "@/lib/chain-server";
export const GET = route(async (request) => {
  const { db, userId } = await requireAuth(request);
  return Response.json({
    data: {
      ...db.detail(userId, pathId(request, "products")),
      chain: productChainProof(db, pathId(request, "products")),
    },
  });
});
