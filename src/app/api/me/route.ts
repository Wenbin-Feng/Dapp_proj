import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";

export const GET = route(async (request) => {
  const { profile, walletAddress } = await requireAuth(request, {
    onboarded: false,
  });
  return Response.json({ data: { profile, wallet_address: walletAddress } });
});
export const PATCH = route(async (request) => {
  const { db, userId, profile } = await requireAuth(request);
  const input = await readJson(
    request,
    z
      .object({
        display_name: z.string().trim().min(1).max(80).optional(),
        organization_name: z.string().trim().max(120).nullable().optional(),
      })
      .strict()
      .refine(
        (v) =>
          v.display_name !== undefined || v.organization_name !== undefined,
        "Provide a field to update.",
      ),
  );
  return Response.json({
    data: db.updateProfile(
      userId,
      input.display_name ?? profile!.display_name,
      input.organization_name === undefined
        ? profile!.organization_name
        : input.organization_name,
    ),
  });
});
