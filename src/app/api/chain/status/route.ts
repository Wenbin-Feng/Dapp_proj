import { route } from "@/lib/http";
import { chainStatus } from "@/lib/chain-server";
import { chainEnabled } from "@/lib/chain-config";
import { getDatabase } from "@/lib/database";
import { cookie, sessionAccount, SESSION_COOKIE } from "@/lib/local-auth";
export const GET = route(async (request) => {
  if (!chainEnabled())
    return Response.json({ data: { enabled: false, ready: false } });
  try {
    const db = getDatabase();
    const account = sessionAccount(db, cookie(request, SESSION_COOKIE));
    return Response.json({
      data: await chainStatus(db, account?.wallet_address),
    });
  } catch {
    return Response.json({ data: await chainStatus() });
  }
});
