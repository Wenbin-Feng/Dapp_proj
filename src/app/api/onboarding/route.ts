import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { ApiError, readJson, route } from "@/lib/http";
import { ROLES, type Profile } from "@/lib/types";

const onboardingSchema = z
  .object({
    display_name: z.string().trim().min(1).max(80),
    role: z.enum(ROLES),
    organization_name: z.string().trim().max(120).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.role !== "customer" && !value.organization_name) {
      context.addIssue({
        code: "custom",
        path: ["organization_name"],
        message: "An organization name is required for this role.",
      });
    }
  });

export const POST = route(async (request) => {
  const { userId, walletAddress, profile, db } = await requireAuth({
    onboarded: false,
  });
  const input = await readJson(request, onboardingSchema);
  if (profile?.onboarding_completed_at) return Response.json({ data: profile });
  const { data, error } = await db.rpc("dapp_complete_onboarding", {
    p_user_id: userId,
    p_wallet_address: walletAddress,
    p_display_name: input.display_name,
    p_role: input.role,
    p_organization_name: input.organization_name || null,
  });
  if (error) {
    if (error.code === "23505" || error.message.startsWith("CONFLICT:")) {
      throw new ApiError(
        409,
        "WALLET_ALREADY_REGISTERED",
        "This wallet is already registered to an account.",
      );
    }
    throw new ApiError(
      error.code === "P0001" ? 400 : 503,
      "ONBOARDING_FAILED",
      "Your profile could not be saved. Please try again.",
    );
  }
  return Response.json({ data: data as Profile });
});
