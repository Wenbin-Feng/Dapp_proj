import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Wallet, getBytes, JsonRpcProvider, Contract } from "ethers";
import { readFileSync } from "node:fs";
const abi = JSON.parse(
  readFileSync(
    new URL("../../src/lib/chain-abi.json", import.meta.url),
    "utf8",
  ),
);
import sharp from "sharp";
const ORIGIN = process.env.TEST_APP_ORIGIN || "http://localhost:3003";
const chainMode = process.env.CHAIN_E2E === "1";
const chainProvider = chainMode
  ? new JsonRpcProvider(process.env.CHAIN_RPC_URL, undefined, {
      cacheTimeout: -1,
      batchMaxCount: 1,
      pollingInterval: 50,
    })
  : null;
test.afterAll(() => chainProvider?.destroy());

// Synthetic EIP-1193 transport, real Ethereum signatures and real local APIs.
// No authentication/business response is intercepted or fabricated.
async function walletBrowser(browser: Browser, failure?: number) {
  const wallet = Wallet.createRandom();
  const context = await browser.newContext({ baseURL: ORIGIN });
  const external: string[] = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      external.push(url.origin);
      await route.abort();
    } else await route.continue();
  });
  await context.exposeBinding(
    "localTestSign",
    async (_source, message: string) => wallet.signMessage(getBytes(message)),
  );
  if (chainProvider)
    await context.exposeBinding(
      "localTestRpc",
      async (_source, method: string, params: unknown[]) => {
        if (method === "eth_sendTransaction") {
          const tx = params[0] as {
            from: string;
            to: string;
            data: string;
            value?: string;
            gas?: string;
          };
          expect(tx.from.toLowerCase()).toBe(wallet.address.toLowerCase());
          return (
            await wallet
              .connect(chainProvider)
              .sendTransaction({
                to: tx.to,
                data: tx.data,
                value: tx.value || 0,
                gasLimit: tx.gas,
              })
          ).hash;
        }
        return chainProvider.send(method, params);
      },
    );
  await context.addInitScript(
    ({ address, code, chain }) => {
      let selectedChain = chain ? "0x1" : "0x7a69",
        networkAdded = false;
      const listeners = new Map<string, Set<(accounts: string[]) => void>>();
      const provider = {
        isMetaMask: true,
        async request({
          method,
          params,
        }: {
          method: string;
          params?: string[];
        }) {
          if (method === "personal_sign" && code === -32603)
            throw { code, message: "MetaMask could not process the signing request." };
          if (method === "eth_requestAccounts" && code && code !== -32603)
            throw Object.assign(new Error("Test wallet request rejected"), {
              code,
            });
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [address];
          if (method === "eth_chainId") return selectedChain;
          if (chain && method === "wallet_switchEthereumChain") {
            if (!networkAdded)
              throw Object.assign(Error("Unknown test network"), {
                code: 4902,
              });
            selectedChain = "0x7a69";
            return null;
          }
          if (chain && method === "wallet_addEthereumChain") {
            networkAdded = true;
            return null;
          }
          if (method === "personal_sign")
            return (
              window as unknown as {
                localTestSign: (message: string) => Promise<string>;
              }
            ).localTestSign(params![0]);
          if (chain) {
            const w = window as unknown as {
              testRejectTransaction?: boolean;
              localTestRpc: (
                method: string,
                params: unknown[],
              ) => Promise<unknown>;
            };
            if (method === "eth_sendTransaction" && w.testRejectTransaction) {
              w.testRejectTransaction = false;
              throw Object.assign(Error("User rejected test transaction"), {
                code: 4001,
              });
            }
            return w.localTestRpc(method, params || []);
          }
          throw new Error(`Unexpected wallet method ${method}`);
        },
        on(name: string, fn: (accounts: string[]) => void) {
          const set = listeners.get(name) || new Set();
          set.add(fn);
          listeners.set(name, set);
        },
        removeListener(name: string, fn: (accounts: string[]) => void) {
          listeners.get(name)?.delete(fn);
        },
      };
      Object.defineProperty(window, "ethereum", {
        value: provider,
        configurable: true,
      });
      Object.defineProperty(window, "testAccountChange", {
        value: (next: string[]) =>
          listeners.get("accountsChanged")?.forEach((fn) => fn(next)),
      });
    },
    { address: wallet.address, code: failure, chain: chainMode },
  );
  const page = await context.newPage();
  return { wallet, context, page, external };
}
async function signIn(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Continue with MetaMask", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);
}
async function registerRole(page: Page, role: string, name: string) {
  await signIn(page);
  await page.getByRole("button", { name: role, exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill(name);
  if (role !== "Customer")
    await page
      .getByLabel("Organization name", { exact: true })
      .fill(name + " Organization");
  await page
    .getByRole("button", { name: "Enter your workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
test("real local signature login persists an HttpOnly session and opens onboarding", async ({
  browser,
}) => {
  const s = await walletBrowser(browser);
  try {
    await signIn(s.page);
    await expect(
      s.page.getByLabel("Connected wallet", { exact: true }),
    ).toHaveValue(s.wallet.address.toLowerCase());
    const cookies = await s.context.cookies();
    expect(cookies.find((c) => c.name === "dapp_session")?.httpOnly).toBe(true);
    await s.page.reload();
    await expect(s.page).toHaveURL(/\/onboarding$/);
    await expect(
      s.page.getByLabel("Display name", { exact: true }),
    ).toBeVisible();
    expect(s.external).toEqual([]);
  } finally {
    await s.context.close();
  }
});
for (const [code, message] of [
  [4001, "The wallet request was cancelled."],
  [-32603, "MetaMask could not process the signing request."],
  [-32002, "A request is already open in MetaMask. Please finish it there."],
] as const)
  test(`wallet ${code} error remains actionable without Supabase`, async ({
    browser,
  }) => {
    const s = await walletBrowser(browser, code);
    try {
      await s.page.goto("/login");
      await s.page
        .getByRole("button", { name: "Continue with MetaMask" })
        .click();
      await expect(s.page.getByText(message, { exact: true })).toBeVisible();
      await expect(
        s.page.getByRole("button", { name: "Continue with MetaMask" }),
      ).toBeEnabled();
      expect(
        (await s.context.cookies()).some((c) => c.name === "dapp_session"),
      ).toBe(false);
      expect(s.external).toEqual([]);
    } finally {
      await s.context.close();
    }
  });
test("the same wallet signs in again with its saved role after logout", async ({ browser }) => {
  const s = await walletBrowser(browser);
  try {
    await registerRole(s.page, "Customer", "Returning customer");
    await s.page.getByRole("link", { name: "My profile", exact: true }).click();
    await s.page.getByLabel("Account role").selectOption("manufacturer");
    await s.page.getByLabel("Organization name", { exact: false }).fill("Demo workshop");
    await s.page.getByRole("button", { name: "Save changes" }).click();
    await expect(s.page.getByText("Your profile has been updated.")).toBeVisible();

    await Promise.all([
      s.page.waitForResponse(r => r.url().endsWith("/api/auth/logout") && r.ok()),
      s.page.getByRole("button", { name: "Sign out" }).click(),
    ]);
    await expect(s.page).toHaveURL(/\/login$/);
    expect((await s.context.request.get(ORIGIN + "/api/me")).status()).toBe(401);
    await s.page.getByRole("button", { name: "Continue with MetaMask" }).click();
    await expect(s.page).toHaveURL(/\/dashboard$/);
    await s.page.reload();
    await expect(s.page.getByText("Manufacturer workspace", { exact: true })).toBeVisible();
    const me = (await (await s.context.request.get(ORIGIN + "/api/me")).json()).data;
    expect(me.wallet_address).toBe(s.wallet.address.toLowerCase());
    expect(me.profile.role).toBe("manufacturer");
  } finally {
    await s.context.close();
  }
});
test("changing accounts revokes the actual server session", async ({
  browser,
}) => {
  const s = await walletBrowser(browser);
  try {
    await registerRole(s.page, "Customer", "Account switch test");
    const old = (await s.context.cookies()).find(
      (c) => c.name === "dapp_session",
    )!;
    await s.page.evaluate(() => {
      (
        window as unknown as { testAccountChange: (next: string[]) => void }
      ).testAccountChange(["0x9999999999999999999999999999999999999999"]);
    });
    await expect(s.page).toHaveURL(/\/login$/);
    await expect
      .poll(async () => {
        const r = await browser.newContext();
        try {
          return (
            await r.request.get(ORIGIN + "/api/me", {
              headers: { cookie: `dapp_session=${old.value}` },
            })
          ).status();
        } finally {
          await r.close();
        }
      })
      .toBe(401);
    expect(s.external).toEqual([]);
  } finally {
    await s.context.close();
  }
});
test("all five wallets complete the real product, image, claim and resale lifecycle", async ({
  browser,
}) => {
  test.setTimeout(chainMode ? 240000 : 120000);
  const sessions: Awaited<ReturnType<typeof walletBrowser>>[] = [];
  try {
    for (const [role, name] of [
      ["Manufacturer", "Local Maker"],
      ["Retailer", "Local Retail"],
      ["Customer", "Customer A"],
      ["Customer", "Customer B"],
      ["Service Center", "Local Repair"],
    ]) {
      const s = await walletBrowser(browser);
      sessions.push(s);
      await registerRole(s.page, role, name);
    }
    const [maker, retail, a, b, center] = sessions;
    await maker.page
      .getByRole("link", { name: "Register product", exact: true })
      .first()
      .click();
    await maker.page
      .getByLabel("Product model", { exact: true })
      .fill("SQLite Integration Watch");
    const serial = "SQLITE-E2E-" + Date.now();
    await maker.page.getByLabel("Serial number", { exact: true }).fill(serial);
    await maker.page
      .getByLabel("Maximum service claims", { exact: true })
      .fill("2");
    if (chainMode) {
      await maker.page.evaluate(() => {
        (
          window as unknown as { testRejectTransaction: boolean }
        ).testRejectTransaction = true;
      });
      await maker.page
        .getByRole("button", { name: "Register product", exact: true })
        .click();
      await expect(
        maker.page.getByText(/The wallet transaction was cancelled/).first(),
      ).toBeVisible();
      // Drop only the confirmation HTTP request, after a real transaction was mined.
      await maker.page.route("**/api/chain/confirm", (route) => route.abort(), {
        times: 1,
      });
    }
    await maker.page
      .getByRole("button", { name: "Register product", exact: true })
      .click();
    if (chainMode) {
      await expect(
        maker.page.getByRole("button", {
          name: "Resume synchronization",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        maker.page.getByText(/Your request is saved/).first(),
      ).toBeVisible();
      await maker.page
        .getByRole("button", { name: "Resume synchronization", exact: true })
        .click();
    }
    await expect(
      maker.page.getByRole("heading", {
        level: 1,
        name: "SQLite Integration Watch",
      }),
    ).toBeVisible();
    const productUrl = maker.page.url();
    const id = productUrl.split("/").at(-1)!;
    const bytes = await sharp({
      create: {
        width: 2200,
        height: 1100,
        channels: 4,
        background: { r: 40, g: 220, b: 160, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    await maker.page.locator('input[type="file"]').setInputFiles({
      name: "watch.png",
      mimeType: "image/png",
      buffer: bytes,
    });
    await maker.page
      .getByRole("button", { name: "Upload optimized image", exact: true })
      .click();
    await expect(
      maker.page.getByText("Product image updated.", { exact: true }),
    ).toBeVisible();
    const imageSrc = await maker.page
      .getByRole("img", { name: "SQLite Integration Watch", exact: true })
      .getAttribute("src");
    expect(imageSrc).toMatch(/^\/api\/images\//);
    expect((await maker.context.request.get(ORIGIN + imageSrc)).status()).toBe(
      200,
    );
    const send = async (from: typeof maker, to: typeof maker) => {
      await from.page.goto(productUrl);
      await from.page
        .getByLabel("Recipient wallet", { exact: true })
        .fill(to.wallet.address);
      await from.page
        .getByRole("button", { name: "Initiate transfer", exact: true })
        .click();
      await expect(
        from.page.getByText(
          "Transfer sent. Ownership changes when the recipient accepts it.",
          { exact: true },
        ),
      ).toBeVisible();
      await to.page.goto("/transfers");
      await to.page
        .getByRole("button", { name: "Accept", exact: true })
        .click();
      await expect(
        to.page.getByText(
          "Transfer accepted. The product now belongs to your wallet.",
          { exact: true },
        ),
      ).toBeVisible();
    };
    await send(maker, retail);
    await send(retail, a);
    await a.page.goto(productUrl);
    await a.page.getByRole("tab", { name: "Warranty", exact: true }).click();
    const centerProfile = (
      await (await center.context.request.get(ORIGIN + "/api/me")).json()
    ).data.profile;
    await a.page
      .getByLabel("Service center", { exact: true })
      .selectOption(centerProfile.id);
    await a.page
      .getByLabel("Describe the issue", { exact: true })
      .fill("Battery will not charge.");
    await a.page
      .getByRole("button", { name: "Submit warranty request", exact: true })
      .click();
    await expect(
      a.page.getByText(
        "Warranty request submitted to your selected service center.",
        { exact: true },
      ),
    ).toBeVisible();
    await center.page.goto("/claims");
    await center.page
      .getByRole("button", { name: "Approve request", exact: true })
      .click();
    await center.page
      .getByRole("button", { name: "Record completed repair", exact: true })
      .click();
    await center.page
      .getByLabel("Repair performed & outcome")
      .fill("Battery replaced and charging verified.");
    await center.page
      .getByRole("button", { name: "Complete & record repair", exact: true })
      .click();
    await expect(
      center.page.getByText(
        "Repair completed and recorded. One service claim has been used.",
        { exact: true },
      ),
    ).toBeVisible();
    const before = (
      await (await a.context.request.get(ORIGIN + `/api/products/${id}`)).json()
    ).data;
    expect(before.product.claims_used).toBe(1);
    expect(before.services).toHaveLength(1);
    await send(a, b);
    const after = (
      await (await b.context.request.get(ORIGIN + `/api/products/${id}`)).json()
    ).data;
    expect(after.product.warranty_started_at).toBe(
      before.product.warranty_started_at,
    );
    expect(after.product.warranty_expires_at).toBe(
      before.product.warranty_expires_at,
    );
    expect(after.product.claims_used).toBe(1);
    expect(after.history).toHaveLength(4);
    expect(after.services).toHaveLength(1);
    if (chainMode) {
      expect(after.chain.transactions).toHaveLength(10);
      const manifest = JSON.parse(
        readFileSync(process.env.CHAIN_DEPLOYMENT_FILE!, "utf8"),
      );
      const c = new Contract(manifest.address, abi, chainProvider);
      const onchain = await c.getProduct("0x" + id.replaceAll("-", ""));
      expect(onchain.owner.toLowerCase()).toBe(b.wallet.address.toLowerCase());
      expect(onchain.claimsUsed).toBe(1n);
      await b.page.goto(productUrl);
      await expect(
        b.page.getByRole("heading", { name: "Blockchain record" }),
      ).toBeVisible();
      await b.page.screenshot({
        path: "test-results/chain-product-desktop.png",
        fullPage: true,
      });
      await b.page.setViewportSize({ width: 390, height: 844 });
      expect(
        await b.page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await b.page.screenshot({
        path: "test-results/chain-product-mobile.png",
        fullPage: true,
      });
      await b.page.setViewportSize({ width: 1280, height: 720 });
      await b.page.goto(
        `/transactions/${after.chain.transactions[0].transaction_hash}`,
      );
      await expect(
        b.page.getByText("confirmed", { exact: true }),
      ).toBeVisible();
    }
    await a.page.goto("/dashboard");
    const workspace = a.page.getByRole("navigation", {
      name: "Workspace navigation",
    });
    await workspace.getByRole("link", { name: "Verify a product" }).click();
    await expect(
      workspace.getByRole("link", { name: "Verify a product" }),
    ).toHaveAttribute("aria-current", "page");
    await workspace.getByRole("link", { name: "Product catalog" }).click();
    await a.page
      .getByLabel("Search by model, brand or serial number")
      .fill(serial);
    await a.page.getByRole("button", { name: "Search", exact: true }).click();
    await a.page.locator(".product-card").filter({ hasText: serial }).click();
    await expect(
      a.page.getByRole("heading", {
        name: "SQLite Integration Watch",
        exact: true,
      }),
    ).toBeVisible();
    await expect(workspace).toBeVisible();
    const outsider: BrowserContext = await browser.newContext({
      baseURL: ORIGIN,
    });
    try {
      const page = await outsider.newPage();
      await page.goto(`/verify?q=${serial}`);
      await expect(
        page.getByRole("heading", {
          name: "SQLite Integration Watch",
          exact: true,
        }),
      ).toBeVisible();
      const publicData = await (
        await outsider.request.get(ORIGIN + `/api/verify?query=${id}`)
      ).json();
      expect(JSON.stringify(publicData)).not.toContain(
        b.wallet.address.toLowerCase(),
      );
      expect(JSON.stringify(publicData)).not.toContain("Battery replaced");
      expect(
        (await outsider.request.get(ORIGIN + `/api/products/${id}`)).status(),
      ).toBe(401);
    } finally {
      await outsider.close();
    }
    await b.page.goto(productUrl);
    await b.page.reload();
    await expect(
      b.page.getByRole("heading", {
        name: "SQLite Integration Watch",
        exact: true,
      }),
    ).toBeVisible();
    sessions.forEach((s) => expect(s.external).toEqual([]));
  } finally {
    for (const s of sessions) await s.context.close();
  }
});
