import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import {
  TEST_AUTH_USER_ID,
  TEST_WALLET_ADDRESS,
  web3User,
} from "./fixtures/web3-user";

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return {
    getUser,
    maybeSingle,
    eq,
    select,
    from,
    createServerSupabase: vi.fn(async () => ({ auth: { getUser } })),
    getAdmin: vi.fn(() => ({ from })),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdmin: mocks.getAdmin }));

// Execute the actual route, auth guard and wallet parser. Only the external
// SDK/database boundaries are substituted; no application auth bypass exists.
import { GET } from "../src/app/api/me/route";

describe("GET /api/me with Supabase Web3 identity responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it("accepts the observed nested identity schema and returns first-login data", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: web3User() }, error: null });

    const response = await GET(new Request("https://app.example.test/api/me"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { profile: null, wallet_address: TEST_WALLET_ADDRESS.toLowerCase() },
    });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("dapp_profiles");
    expect(mocks.eq).toHaveBeenCalledWith("id", TEST_AUTH_USER_ID);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns AUTH_REQUIRED without a verified session and never queries profiles", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    const response = await GET(new Request("https://app.example.test/api/me"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns WALLET_LOGIN_REQUIRED for another user's identity before reading profiles", async () => {
    const user = web3User();
    user.identities![0].user_id = "20000000-0000-4000-8000-000000000099";
    // Editable metadata cannot repair a mismatched, server-returned identity.
    user.user_metadata = { wallet_address: TEST_WALLET_ADDRESS };
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });

    const response = await GET(new Request("https://app.example.test/api/me"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "WALLET_LOGIN_REQUIRED" },
    });
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
