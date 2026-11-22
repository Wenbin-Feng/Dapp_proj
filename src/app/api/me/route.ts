import { ROLES } from "@/lib/types";
import { chainEnabled } from "@/lib/chain-config";
import { registerWalletRole, syncChain } from "@/lib/chain-server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { ApiError, readJson, route } from "@/lib/http";

export const GET = route(async (request) => {
  const { profile, walletAddress } = await requireAuth(request, {
    onboarded: false,
  });
  return Response.json({ data: { profile, wallet_address: walletAddress } });
});
export const PATCH = route(async (request) => {
  const { db, userId, profile, walletAddress } = await requireAuth(request);
  const input = await readJson(
    request,
    z
      .object({
        role: z.enum(ROLES).optional(),
        display_name: z.string().trim().min(1).max(80).optional(),
        organization_name: z.string().trim().max(120).nullable().optional(),
      })
      .strict()
      .refine(
        (v) =>
          v.role !== undefined || v.display_name !== undefined || v.organization_name !== undefined,
        "Provide a field to update.",
      ),
  );
  const role = input.role ?? profile!.role;
  const organization = input.organization_name === undefined ? profile!.organization_name : input.organization_name;
  if (role !== "customer" && !organization?.trim())
    throw new ApiError(400, "INVALID_INPUT", "Enter an organization name for this role.");
  if (chainEnabled() && input.role && input.role !== profile!.role) {
    await registerWalletRole(walletAddress, role, profile!.role);
    await syncChain(db);
    if (db.profile(userId)?.role !== role)
      throw new ApiError(409, "ROLE_CHANGED", "Your role changed. Refresh your profile and try again.");
  }
  return Response.json({data: db.updateProfile(userId, input.display_name ?? profile!.display_name,
    organization, chainEnabled() ? undefined : input.role)});
});
