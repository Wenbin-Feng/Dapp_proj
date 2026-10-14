import { vi, describe, it, expect } from "vitest";
vi.mock("server-only", () => ({}));
import type { User } from "@supabase/supabase-js";
import { verifiedWalletAddress } from "../src/lib/auth";
const address = "0xAa00000000000000000000000000000000000001";
const user = (identities: unknown[], metadata: unknown = {}): User =>
  ({ id: "user-1", identities, user_metadata: metadata }) as unknown as User;
const identity = {
  provider: "web3",
  user_id: "user-1",
  identity_data: { chain: "ethereum", address },
};
describe("Wallet identity binding", () => {
  it("normalizes verified Ethereum identity addresses", () => {
    expect(verifiedWalletAddress(user([identity]))).toBe(address.toLowerCase());
  });
  it("never accepts a self-reported wallet in editable metadata", () => {
    expect(() =>
      verifiedWalletAddress(user([], { wallet_address: address })),
    ).toThrow();
  });
  it("rejects identities from a different user or chain", () => {
    expect(() =>
      verifiedWalletAddress(user([{ ...identity, user_id: "other-user" }])),
    ).toThrow();
    expect(() =>
      verifiedWalletAddress(
        user([{ ...identity, identity_data: { chain: "solana", address } }]),
      ),
    ).toThrow();
  });
  it("enforces one wallet per application account", () => {
    expect(() =>
      verifiedWalletAddress(
        user([
          identity,
          {
            ...identity,
            identity_data: {
              chain: "ethereum",
              address: "0xbb00000000000000000000000000000000000002",
            },
          },
        ]),
      ),
    ).toThrow();
  });
});
