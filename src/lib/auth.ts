import "server-only";
import { getDatabase } from "./database";
import { cookie, sessionAccount, SESSION_COOKIE } from "./local-auth";
import { ApiError } from "./http";
import type { Role } from "./types";
import { syncChain } from "./chain-server";
export async function requireAuth(
  request: Request,
  options: { onboarded?: boolean; roles?: Role[] } = {},
) {
  const db = getDatabase(),
    account = sessionAccount(db, cookie(request, SESSION_COOKIE));
  if (!account)
    throw new ApiError(
      401,
      "AUTH_REQUIRED",
      "Connect your MetaMask wallet to continue.",
    );
  await syncChain(db);
  const profile = db.profile(account.id);
  if (options.onboarded !== false && !profile)
    throw new ApiError(
      403,
      "ONBOARDING_REQUIRED",
      "Complete your profile to continue.",
    );
  if (
    options.roles?.length &&
    (!profile || !options.roles.includes(profile.role))
  )
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your role cannot perform this action.",
    );
  return {
    userId: account.id,
    walletAddress: account.wallet_address,
    profile,
    db,
  };
}
