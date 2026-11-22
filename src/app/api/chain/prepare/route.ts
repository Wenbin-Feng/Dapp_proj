import { route, readJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { requireChainMode } from "@/lib/chain-config";
import { chainCommandSchema, prepareTransaction } from "@/lib/chain-server";
export const POST = route(async (request) => {
  requireChainMode();
  const { db, userId } = await requireAuth(request);
  const input = await readJson(request, chainCommandSchema);
  return Response.json({ data: await prepareTransaction(db, userId, input) });
});
