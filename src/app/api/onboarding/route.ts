import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { ROLES } from "@/lib/types";
import { chainEnabled } from "@/lib/chain-config";
import { roleNames } from "@/lib/chain-projection";
import { ApiError } from "@/lib/http";
export const POST = route(async (request) => {
  const { db, userId, walletAddress } = await requireAuth(request, {
    onboarded: false,
  });
  const input = await readJson(
    request,
    z
      .object({
        display_name: z.string().trim().min(1).max(80),
        role: z.enum(ROLES),
        organization_name: z.string().trim().max(120).nullable().optional(),
      })
      .strict()
      .superRefine((v, c) => {
        if (v.role !== "customer" && !v.organization_name)
          c.addIssue({
            code: "custom",
            path: ["organization_name"],
            message: "An organization name is required for this role.",
          });
      }),
  );
  if (chainEnabled()) {
    const granted =
      db.get<{ role: number }>(
        "SELECT role FROM chain_roles WHERE wallet=?",
        walletAddress,
      )?.role || 0;
    if (roleNames[granted] !== input.role)
      throw new ApiError(
        403,
        "CHAIN_ROLE_REQUIRED",
        "This role has not been granted to your wallet on-chain. Ask the deployment administrator to run npm run chain:grant -- YOUR_ADDRESS YOUR_ROLE, then retry.",
      );
  }
  return Response.json({ data: db.onboard(userId, walletAddress, input) });
});
