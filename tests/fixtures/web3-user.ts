import type { User } from "@supabase/supabase-js";

export const TEST_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
export const TEST_WALLET_ADDRESS = "0xAa00000000000000000000000000000000000001";

// Fictional values in the observed Supabase Web3 identity shape. The nesting is
// defined by provider.Claims.CustomClaims and the Ethereum Web3 grant:
// https://github.com/supabase/auth/blob/master/internal/api/provider/provider.go
// https://github.com/supabase/auth/blob/master/internal/api/web3.go
export function web3User(): User {
  const subject = `web3:ethereum:${TEST_WALLET_ADDRESS}`;
  return {
    id: TEST_AUTH_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "web3", providers: ["web3"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    identities: [
      {
        id: subject,
        identity_id: "00000000-0000-4000-8000-000000000002",
        user_id: TEST_AUTH_USER_ID,
        provider: "web3",
        identity_data: {
          custom_claims: {
            address: TEST_WALLET_ADDRESS,
            chain: "ethereum",
            domain: "example.test",
            network: "1",
            statement: "Sign in to a test application.",
          },
          email_verified: false,
          phone_verified: false,
          sub: subject,
        },
      },
    ],
  };
}
