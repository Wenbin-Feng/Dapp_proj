import { z } from "zod";
import { ApiError, route } from "@/lib/http";
import { getAdmin } from "@/lib/supabase/admin";
import { publicProduct } from "@/lib/products-server";

export const GET = route(async (request) => {
  const parsed = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .safeParse(new URL(request.url).searchParams.get("query"));
  if (!parsed.success)
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "Enter a product ID or serial number.",
    );
  return Response.json({ data: await publicProduct(getAdmin(), parsed.data) });
});
