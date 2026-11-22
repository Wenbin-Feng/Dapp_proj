import { requireAuth } from "@/lib/auth";
import { route } from "@/lib/http";
export const GET = route(async (request) => {
  const { db, userId } = await requireAuth(request);
  return Response.json({ data: db.serviceCenters() });
});
