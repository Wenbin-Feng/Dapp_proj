import { z } from "zod";
import { getDatabase } from "@/lib/database";
import { readJson, route } from "@/lib/http";
import {
  cookie,
  verifyChallenge,
  setAuthCookie,
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "@/lib/local-auth";
export const POST = route(async (request) => {
  const input = await readJson(
    request,
    z
      .object({
        id: z.uuid(),
        signature: z.string().regex(/^0x[0-9a-fA-F]{128,130}$/),
      })
      .strict(),
  );
  const origin = request.headers.get("origin")!;
  const verified = verifyChallenge(
    getDatabase(),
    input.id,
    input.signature,
    cookie(request, CHALLENGE_COOKIE),
    origin,
    cookie(request, SESSION_COOKIE),
  );
  const response = Response.json({
    data: {
      profile: verified.profile,
      wallet_address: verified.wallet_address,
    },
  });
  setAuthCookie(
    response,
    SESSION_COOKIE,
    verified.token,
    SESSION_SECONDS,
    origin,
  );
  setAuthCookie(response, CHALLENGE_COOKIE, "", 0, origin);
  return response;
});
