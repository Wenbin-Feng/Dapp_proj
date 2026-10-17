import { route } from "@/lib/http";
import { getDemoConfig } from "@/lib/chain/server";

export const GET = route(async () =>
  Response.json({ data: await getDemoConfig() }),
);
