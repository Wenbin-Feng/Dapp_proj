import { getDatabase } from "@/lib/database";
import { route } from "@/lib/http";
import {
  cookie,
  hashToken,
  setAuthCookie,
  SESSION_COOKIE,
  CHALLENGE_COOKIE,
} from "@/lib/local-auth";
export const POST = route(async (request) => {
  const token = cookie(request, SESSION_COOKIE);
  if (token)
    getDatabase().run(
      "DELETE FROM sessions WHERE token_hash=?",
      hashToken(token),
    );
  const response = Response.json({ data: { signed_out: true } }),
    origin = request.headers.get("origin")!;
  setAuthCookie(response, SESSION_COOKIE, "", 0, origin);
  setAuthCookie(response, CHALLENGE_COOKIE, "", 0, origin);
  return response;
});
