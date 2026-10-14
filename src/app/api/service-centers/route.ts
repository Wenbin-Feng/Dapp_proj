import { requireAuth } from "@/lib/auth";
import { route } from "@/lib/http";
import { databaseError } from "@/lib/products-server";

export const GET = route(async () => {
  const { db } = await requireAuth();
  const { data, error } = await db
    .from("dapp_profiles")
    .select("id,organization_name,wallet_address")
    .eq("role", "service_center")
    .order("organization_name");
  if (error) databaseError(error);
  return Response.json({ data: data || [] });
});
