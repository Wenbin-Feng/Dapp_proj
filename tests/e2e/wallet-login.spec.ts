import { test, expect } from "@playwright/test";
import {
  TEST_AUTH_USER_ID,
  TEST_WALLET_ADDRESS,
  web3User,
} from "../fixtures/web3-user";

const APP_ORIGIN = "http://localhost:3000";
const TEST_SUPABASE_ORIGIN = "http://127.0.0.1:54321";
const isolatedEnvironment =
  process.env.CI === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL === TEST_SUPABASE_ORIGIN &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ===
    "sb_publishable_ci_fixture_only";

// This exercises the actual browser SDK and WalletProvider with fabricated
// credentials. It does not verify a real signature or execute server-side Auth.
// Browser routing cannot intercept Next.js proxy's outbound requests, so this
// case requires the CI server's Supabase URL to point exclusively to loopback.
test("MetaMask first login persists the SDK session and opens onboarding", async ({
  browser,
}) => {
  test.skip(
    !isolatedEnvironment,
    "Requires CI=true and the isolated loopback Supabase fixture configuration; never run against a cloud-connected server.",
  );

  const context = await browser.newContext({
    baseURL: APP_ORIGIN,
    serviceWorkers: "block",
  });
  const walletAddress = TEST_WALLET_ADDRESS.toLowerCase();
  const signature = `0x${"1".repeat(130)}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: TEST_AUTH_USER_ID, exp: expiresAt, role: "authenticated" }),
    encode("fabricated-test-signature-not-valid-for-authentication"),
  ].join(".");
  const sessionResponse = {
    access_token: accessToken,
    refresh_token: "fabricated-browser-test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: web3User(),
  };
  let web3Exchanges = 0;
  let verifiedCookieSeenByMe = false;

  try {
    await context.addInitScript(
      ({ address, signedMessage }) => {
        const calls: string[] = [];
        const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
        const provider = {
          isMetaMask: true,
          address,
          async request({ method }: { method: string }) {
            calls.push(method);
            switch (method) {
              case "eth_accounts":
              case "eth_requestAccounts":
                return [address];
              case "eth_chainId":
                return "0x1";
              case "personal_sign":
                return signedMessage;
              default:
                throw new Error(`Unexpected test wallet method: ${method}`);
            }
          },
          on(event: string, callback: (...args: unknown[]) => void) {
            const callbacks = listeners.get(event) || new Set();
            callbacks.add(callback);
            listeners.set(event, callbacks);
          },
          removeListener(event: string, callback: (...args: unknown[]) => void) {
            listeners.get(event)?.delete(callback);
          },
        };
        Object.defineProperty(window, "ethereum", {
          value: provider,
          configurable: true,
        });
        Object.defineProperty(window, "__testWalletCalls", { value: calls });
      },
      { address: walletAddress, signedMessage: signature },
    );

    // One context-level boundary covers all browser Auth and business calls.
    // Unrecognized external traffic is blocked rather than sent to the cloud.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith("/auth/v1/")) {
        expect(url.origin).toBe(TEST_SUPABASE_ORIGIN);
        const headers = {
          "access-control-allow-origin": APP_ORIGIN,
          "access-control-allow-headers":
            "apikey,authorization,content-type,x-client-info,x-supabase-api-version",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        };
        if (request.method() === "OPTIONS") {
          await route.fulfill({ status: 204, headers });
        } else if (url.pathname.endsWith("/token")) {
          expect(url.searchParams.get("grant_type")).toBe("web3");
          expect(request.postDataJSON()).toMatchObject({
            chain: "ethereum",
            signature,
          });
          web3Exchanges += 1;
          await route.fulfill({ json: sessionResponse, headers });
        } else if (url.pathname.endsWith("/user")) {
          await route.fulfill({ json: web3User(), headers });
        } else if (url.pathname.endsWith("/logout")) {
          await route.fulfill({ json: {}, headers });
        } else {
          await route.fulfill({
            status: 501,
            json: { message: "Unexpected mocked authentication request." },
            headers,
          });
        }
        return;
      }

      if (url.origin !== APP_ORIGIN) {
        await route.abort("blockedbyclient");
        return;
      }

      if (url.pathname === "/api/me") {
        const cookie = (await request.allHeaders()).cookie || "";
        const hasSessionCookie =
          /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(cookie);
        if (!hasSessionCookie) {
          await route.fulfill({
            status: 401,
            json: {
              error: { code: "AUTH_REQUIRED", message: "Connect your wallet." },
            },
          });
          return;
        }
        verifiedCookieSeenByMe = true;
        await route.fulfill({
          json: { data: { profile: null, wallet_address: walletAddress } },
        });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        await route.fulfill({
          status: 501,
          json: { error: { message: "Unexpected mocked business request." } },
        });
        return;
      }

      await route.continue();
    });

    const page = await context.newPage();
    await page.goto("/login");
    const connect = page.getByRole("button", {
      name: "Continue with MetaMask",
    });
    await expect(connect).toBeEnabled();
    await connect.click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Connected wallet", { exact: true })).toHaveValue(
      walletAddress,
    );
    await expect(page.getByRole("group", { name: "Choose your role" })).toBeVisible();
    expect(web3Exchanges).toBe(1);
    expect(verifiedCookieSeenByMe).toBe(true);

    const sessionCookies = (await context.cookies(APP_ORIGIN)).filter((cookie) =>
      /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name),
    );
    expect(sessionCookies.length).toBeGreaterThan(0);
    expect(sessionCookies.every((cookie) => cookie.path === "/")).toBe(true);
    const walletCalls = await page.evaluate(
      () =>
        (window as Window & { __testWalletCalls?: string[] }).__testWalletCalls || [],
    );
    expect(walletCalls).toEqual(
      expect.arrayContaining([
        "eth_requestAccounts",
        "eth_chainId",
        "personal_sign",
      ]),
    );
  } finally {
    await context.close();
  }
});
