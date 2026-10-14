import { vi, describe, it, expect } from "vitest";
vi.mock("server-only", () => ({}));
import { verifiedWalletAddress } from "../src/lib/auth";
import { TEST_WALLET_ADDRESS, web3User } from "./fixtures/web3-user";

describe("Wallet identity binding", () => {
  it("normalizes the nested claims returned by Supabase Ethereum Auth", () => {
    expect(verifiedWalletAddress(web3User())).toBe(
      TEST_WALLET_ADDRESS.toLowerCase(),
    );
  });
  it("rejects another identity provider", () => {
    const user = web3User();
    user.identities![0].provider = "email";
    expect(() => verifiedWalletAddress(user)).toThrow();
  });
  it("rejects an identity bound to another user", () => {
    const user = web3User();
    user.identities![0].user_id = "00000000-0000-4000-8000-000000000003";
    expect(() => verifiedWalletAddress(user)).toThrow();
  });
  it("rejects a different chain in the verified claims", () => {
    const user = web3User();
    user.identities![0].identity_data!.custom_claims.chain = "solana";
    expect(() => verifiedWalletAddress(user)).toThrow();
  });
  it("rejects missing, primitive and array custom claims", () => {
    for (const claims of [undefined, null, "ethereum", [], true]) {
      const user = web3User();
      user.identities![0].identity_data!.custom_claims = claims;
      expect(() => verifiedWalletAddress(user)).toThrow();
    }
  });
  it("rejects malformed wallet addresses", () => {
    for (const address of ["0xnot-an-address", `0x${"a".repeat(39)}`, 1]) {
      const user = web3User();
      user.identities![0].identity_data!.custom_claims.address = address;
      expect(() => verifiedWalletAddress(user)).toThrow();
    }
  });
  it("enforces one wallet per application account", () => {
    const user = web3User();
    const secondIdentity = web3User().identities![0];
    secondIdentity.identity_data!.custom_claims.address =
      "0xbb00000000000000000000000000000000000002";
    user.identities!.push(secondIdentity);
    expect(() => verifiedWalletAddress(user)).toThrow();
  });
  it("treats case variants of the same wallet as one identity", () => {
    const user = web3User();
    const duplicateIdentity = web3User().identities![0];
    duplicateIdentity.identity_data!.custom_claims.address =
      TEST_WALLET_ADDRESS.toLowerCase();
    user.identities!.push(duplicateIdentity);
    expect(verifiedWalletAddress(user)).toBe(TEST_WALLET_ADDRESS.toLowerCase());
  });
  it("never falls back to editable metadata or top-level wallet fields", () => {
    const user = web3User();
    user.user_metadata = {
      wallet_address: TEST_WALLET_ADDRESS,
      custom_claims: { chain: "ethereum", address: TEST_WALLET_ADDRESS },
    };
    user.identities = [];
    expect(() => verifiedWalletAddress(user)).toThrow();
    const topLevel = web3User();
    topLevel.identities![0].identity_data = {
      chain: "ethereum",
      address: TEST_WALLET_ADDRESS,
    };
    expect(() => verifiedWalletAddress(topLevel)).toThrow();
  });
});
