import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { ApiError, readJson, route } from "@/lib/http";
import type { Profile } from "@/lib/types";

export const GET = route(async () => {
  const { profile, walletAddress } = await requireAuth({ onboarded: false });
  return Response.json({ data: { profile, wallet_address: walletAddress } });
});

const updateSchema = z
  .object({
    display_name: z.string().trim().min(1).max(80).optional(),
    organization_name: z.string().trim().max(120).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.display_name !== undefined || value.organization_name !== undefined,
    "Provide a field to update.",
  );

export const PATCH = route(async (request) => {
  const { userId, profile, db } = await requireAuth();
  const input = await readJson(request, updateSchema);
  if (!profile)
    throw new ApiError(
      403,
      "ONBOARDING_REQUIRED",
      "Complete your profile to continue.",
    );
  const name = input.display_name ?? profile.display_name;
  const organization =
    input.organization_name === undefined
      ? profile.organization_name
      : input.organization_name || null;
  if (profile.role !== "customer" && !organization) {
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "An organization name is required for this role.",
    );
  }
  const { data, error } = await db.rpc("dapp_update_profile", {
    p_user_id: userId,
    p_display_name: name,
    p_organization_name: organization,
  });
  if (error)
    throw new ApiError(
      error.code === "P0001" ? 400 : 503,
      "PROFILE_UPDATE_FAILED",
      "Your profile could not be updated. Please try again.",
    );
  return Response.json({ data: data as Profile });
});
