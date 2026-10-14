import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { getAdmin } from "@/lib/supabase/admin";
import { ApiError } from "@/lib/http";
import type { Profile, Role } from "@/lib/types";

export function verifiedWalletAddress(user: User): string {
  // getUser() supplies server-verified identities. user_metadata is user-editable.
  const addresses = new Set(
    (user.identities || []).flatMap((identity) => {
      const data = identity.identity_data;
      if (
        identity.provider !== "web3" ||
        identity.user_id !== user.id ||
        data?.chain !== "ethereum"
      )
        return [];
      return typeof data.address === "string" &&
        /^0x[0-9a-fA-F]{40}$/.test(data.address)
        ? [data.address.toLowerCase()]
        : [];
    }),
  );
  if (addresses.size !== 1) {
    throw new ApiError(
      401,
      "WALLET_LOGIN_REQUIRED",
      "Sign in with one Ethereum wallet to continue.",
    );
  }
  return [...addresses][0];
}

export async function requireAuth(
  options: { onboarded?: boolean; roles?: Role[] } = {},
): Promise<{
  userId: string;
  walletAddress: string;
  profile: Profile | null;
  db: SupabaseClient;
}> {
  const auth = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (
    error &&
    ((error.status && error.status >= 500) ||
      error.name === "AuthRetryableFetchError")
  ) {
    throw new ApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Wallet authentication is unavailable. Please try again.",
    );
  }
  if (error || !user)
    throw new ApiError(
      401,
      "AUTH_REQUIRED",
      "Connect your MetaMask wallet to continue.",
    );
  const walletAddress = verifiedWalletAddress(user);
  const db = getAdmin();
  const { data, error: profileError } = await db
    .from("dapp_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError)
    throw new ApiError(
      503,
      "DATA_UNAVAILABLE",
      "Account data is unavailable. Please try again.",
    );
  const profile = data as Profile | null;
  if (profile && profile.wallet_address.toLowerCase() !== walletAddress) {
    throw new ApiError(
      409,
      "WALLET_BINDING_MISMATCH",
      "This account is bound to a different wallet.",
    );
  }
  if (options.onboarded !== false && !profile?.onboarding_completed_at) {
    throw new ApiError(
      403,
      "ONBOARDING_REQUIRED",
      "Complete your profile to continue.",
    );
  }
  if (
    options.roles?.length &&
    (!profile || !options.roles.includes(profile.role))
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your role cannot perform this action.",
    );
  }
  return { userId: user.id, walletAddress, profile, db };
}
