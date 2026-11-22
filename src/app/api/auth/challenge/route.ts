import { z } from "zod";
import { getDatabase } from "@/lib/database";
import { readJson, route } from "@/lib/http";
import {
  issueChallenge,
  setAuthCookie,
  CHALLENGE_COOKIE,
  CHALLENGE_SECONDS,
} from "@/lib/local-auth";
export const POST = route(async (request) => {
  const input = await readJson(
    request,
    z
      .object({
        wallet_address: z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/)
          .transform((v) => v.toLowerCase()),
        chain_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
  );
  const origin = request.headers.get("origin")!;
  const challenge = issueChallenge(
    getDatabase(),
    input.wallet_address,
    input.chain_id,
    origin,
  );
  const response = Response.json({
    data: { id: challenge.id, message: challenge.message },
  });
  setAuthCookie(
    response,
    CHALLENGE_COOKIE,
    challenge.binding,
    CHALLENGE_SECONDS,
    origin,
  );
  return response;
});
