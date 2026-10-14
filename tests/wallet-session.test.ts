import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "../src/lib/wallet-session";
import type { MeData } from "../src/lib/types";

function mockAccountResponse(status: number, body: unknown) {
  const request = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", request);
  return request;
}

afterEach(() => vi.unstubAllGlobals());

describe("Wallet session restoration", () => {
  it("treats an absent authentication session as signed out", async () => {
    mockAccountResponse(401, {
      error: {
        code: "AUTH_REQUIRED",
        message: "Connect your MetaMask wallet to continue.",
      },
    });

    await expect(fetchMe()).resolves.toBeNull();
  });

  it("keeps the verified wallet when a first-time user has no profile", async () => {
    const firstLogin: MeData = {
      wallet_address: "0xaa00000000000000000000000000000000000001",
      profile: null,
    };
    const request = mockAccountResponse(200, { data: firstLogin });

    await expect(fetchMe()).resolves.toEqual(firstLogin);
    expect(request).toHaveBeenCalledWith(
      "/api/me",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
  });

  it("surfaces a rejected wallet identity instead of reporting no session", async () => {
    const message = "Sign in with one Ethereum wallet to continue.";
    mockAccountResponse(401, {
      error: { code: "WALLET_LOGIN_REQUIRED", message },
    });

    await expect(fetchMe()).rejects.toThrow(message);
  });

  it("preserves an actionable temporary authentication failure", async () => {
    const message = "Wallet authentication is unavailable. Please try again.";
    mockAccountResponse(503, {
      error: { code: "AUTH_UNAVAILABLE", message },
    });

    await expect(fetchMe()).rejects.toThrow(message);
  });
});
