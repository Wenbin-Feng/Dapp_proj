// Identity/HTTP boundaries are fixtures. Transactions, receipts, event reduction
// and the PostgreSQL index are real. Server privacy/auth are separately integrated in Vitest.
import { test, expect, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { network } from "hardhat";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  erc20Abi,
  parseEther,
  getAddress,
  type Abi,
  type Address,
  type Hex,
  type Hash,
} from "viem";
import { pgliteClient } from "../fixtures/pglite-client";
import { productAbi } from "../../src/lib/chain/product-abi";
import {
  productHex,
  productReceiptEvents,
} from "../../src/lib/chain/product-events";
import type { ProductEvent } from "../../src/lib/chain/product-events";
import { reduceProductEvents } from "../../src/lib/chain/product-state";
import {
  syncProductIndex,
  type ProductClient,
  type ProductConfig,
} from "../../src/lib/chain/product-indexer";
import { payloadCommitment } from "../../src/lib/chain/private-payload";
import type { PrivatePayload } from "../../src/lib/chain/private-payload";
import type { Claim, Profile, ServiceRecord } from "../../src/lib/types";

test("manufacturer, retailer, buyer and repair center complete a PDC purchase and warranty", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const server = await network.createServer("hardhat", "127.0.0.1", 0);
  const { port } = await server.listen();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = defineChain({
    id: 31337,
    name: "Hardhat",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
    cacheTime: 0,
  });
  const addresses = await createWalletClient({
    chain,
    transport: http(rpcUrl),
  }).getAddresses();
  const wallets = addresses.map((account) =>
    createWalletClient({ account, chain, transport: http(rpcUrl) }),
  );
  const pg = new PGlite();
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  try {
    await pg.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;",
    );
    await pg.exec(
      await readFile("supabase/migrations/202610160001_demo_chain.sql", "utf8"),
    );
    const db = pgliteClient(pg).client;
    async function deploy(name: string, args: readonly unknown[]) {
      const build = JSON.parse(
        await readFile(`artifacts/contracts/${name}.sol/${name}.json`, "utf8"),
      );
      const receipt = await client.waitForTransactionReceipt({
        hash: await wallets[0].deployContract({
          abi: build.abi,
          bytecode: build.bytecode,
          args,
        }),
      });
      return getAddress(receipt.contractAddress!);
    }
    const pdc = await deploy("DemoToken", ["PDC", "PDC", addresses[0]]);
    const pdq = await deploy("DemoToken", ["PDQ", "PDQ", addresses[0]]);
    const products = await deploy("DemoProducts", [pdc]);
    const config: ProductConfig = {
      version: "demo-v1",
      chainId: 31337,
      treasury: getAddress(addresses[0]),
      pdc,
      pdq,
      products,
      fromBlock: "0",
      rpcUrl,
      productBackend: "chain",
    };
    const profiles: Profile[] = (
      [
        "manufacturer",
        "retailer",
        "customer",
        "customer",
        "service_center",
      ] as const
    ).map((role, index) => ({
      id: randomUUID(),
      wallet_address: addresses[index].toLowerCase(),
      role,
      display_name: `Demo ${role}`,
      organization_name: role === "customer" ? null : `Demo ${role}`,
      created_at: new Date().toISOString(),
      onboarding_completed_at: new Date().toISOString(),
    }));
    let rejectPurchaseIndexOnce = true;
    async function execute(
      who: number,
      address: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
    ) {
      const { request } = await client.simulateContract({
        address,
        abi,
        functionName,
        args,
        account: addresses[who],
      });
      return client.waitForTransactionReceipt({
        hash: await wallets[who].writeContract(request),
      });
    }
    for (const [who, role] of [
      [1, 2],
      [2, 3],
      [3, 3],
      [4, 4],
    ])
      await execute(who, products, productAbi, "enroll", [role]);
    await execute(0, pdc, erc20Abi, "transfer", [
      addresses[2],
      parseEther("1000"),
    ]);
    async function view(profile: Profile, id?: string) {
      const events = await pg.query<ProductEvent>(
        "select * from dapp_demo_chain_events order by block_number,log_index",
      );
      const state = reduceProductEvents(events.rows);
      const profileFor = (wallet: string) =>
        profiles.find((p) => p.wallet_address === wallet);
      for (const p of state.products.values()) {
        p.owner_id = profileFor(p.owner_wallet)?.id || p.owner_wallet;
        p.manufacturer_id =
          profileFor(p.manufacturer_wallet)?.id || p.manufacturer_wallet;
        p.manufacturer_name = "Demo manufacturer";
      }
      for (const t of state.transfers.values()) {
        t.from_user_id = profileFor(t.from_wallet)?.id || t.from_wallet;
        t.to_user_id = profileFor(t.to_wallet)?.id || t.to_wallet;
        const p = state.products.get(t.product_id)!;
        t.model = p.model;
        t.serial_number = p.serial_number;
      }
      const raw = await pg.query<PrivatePayload>(
        "select * from dapp_demo_private_payloads",
      );
      for (const c of state.claims.values()) {
        c.customer_id = profileFor(c.customer_wallet)?.id || c.customer_wallet;
        c.service_center_id =
          profileFor(c.center_wallet)?.id || c.center_wallet;
        c.service_center_name = "Demo service center";
        c.model = state.products.get(c.product_id)!.model;
        for (const payload of raw.rows) {
          if (payload.commitment === c.description_hash)
            c.description = payload.body;
          if (payload.commitment === c.resolution_hash)
            c.resolution = payload.body;
        }
      }
      const related = (c: Claim) =>
        c.customer_id === profile.id || c.service_center_id === profile.id;
      const transfers = [...state.transfers.values()].filter(
        (t) => t.from_user_id === profile.id || t.to_user_id === profile.id,
      );
      const claims = [...state.claims.values()].filter(related);
      if (!id)
        return {
          products: [...state.products.values()].filter(
            (p) => p.owner_id === profile.id,
          ),
          transfers,
          claims,
        };
      const product = state.products.get(id);
      const services: ServiceRecord[] = [...state.claims.values()]
        .filter(
          (c) =>
            c.product_id === id &&
            c.status === "completed" &&
            (related(c) || product?.owner_id === profile.id),
        )
        .map((c) => ({
          id: c.id,
          product_id: id,
          claim_id: c.id,
          service_center_id: c.service_center_id,
          description: c.resolution!,
          created_at: c.resolved_at!,
        }));
      return {
        product,
        transfers: transfers.filter((t) => t.product_id === id),
        claims: claims.filter((c) => c.product_id === id),
        history: state.history.filter((h) => h.product_id === id),
        services,
      };
    }
    async function participantPage(who: number, waitForDiscovery = false) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.exposeFunction(
        "productWalletRpc",
        async (method: string, params: unknown[]) => {
          if (method === "eth_sendTransaction")
            expect((params[0] as { from: string }).from.toLowerCase()).toBe(
              profiles[who].wallet_address,
            );
          return client.request({ method, params } as never);
        },
      );
      await page.addInitScript(
        ({ account, waitForDiscovery }) => {
          const listeners = new Map<
            string,
            Set<(...args: unknown[]) => void>
          >();
          const provider = {
            isMetaMask: true,
            async request({
              method,
              params = [],
            }: {
              method: string;
              params?: unknown[];
            }) {
              if (["eth_accounts", "eth_requestAccounts"].includes(method))
                return [account];
              return (
                window as unknown as {
                  productWalletRpc: (
                    method: string,
                    params: unknown[],
                  ) => Promise<unknown>;
                }
              ).productWalletRpc(method, params);
            },
            on(event: string, callback: (...args: unknown[]) => void) {
              const list = listeners.get(event) || new Set();
              list.add(callback);
              listeners.set(event, list);
            },
            removeListener(
              event: string,
              callback: (...args: unknown[]) => void,
            ) {
              listeners.get(event)?.delete(callback);
            },
          };
          if (waitForDiscovery) {
            window.addEventListener("product-test-provider-ready", () =>
              window.dispatchEvent(
                new CustomEvent("eip6963:announceProvider", {
                  detail: { info: { rdns: "io.metamask" }, provider },
                }),
              ),
            );
          } else {
            Object.defineProperty(window, "ethereum", { value: provider });
          }
        },
        { account: addresses[who], waitForDiscovery },
      );
      await page.route("**/api/**", async (route) => {
        try {
          const url = new URL(route.request().url()),
            profile = profiles[who];
          let data: unknown;
          if (url.pathname === "/api/me")
            data = { wallet_address: profile.wallet_address, profile };
          else if (url.pathname === "/api/chain/config") data = config;
          else if (url.pathname === "/api/chain/sync") {
            const hash = route.request().postDataJSON().transaction_hash as
              Hash | undefined;
            if (hash && rejectPurchaseIndexOnce) {
              const receipt = await client.getTransactionReceipt({ hash });
              if (
                productReceiptEvents(receipt, config).some(
                  (event) =>
                    event.event_name === "TransferResolved" &&
                    event.payload.status === 2 &&
                    BigInt(event.payload.price) > 0n,
                )
              ) {
                rejectPurchaseIndexOnce = false;
                throw new Error(
                  "Temporary index delay; synchronize the confirmed receipt again.",
                );
              }
            }
            data = await syncProductIndex(
              client as ProductClient,
              db,
              config,
              hash,
            );
          } else if (url.pathname === "/api/dashboard")
            data = await view(profile);
          else if (/^\/api\/products\/[0-9a-f-]+$/.test(url.pathname))
            data = await view(profile, url.pathname.split("/").at(-1));
          else if (url.pathname === "/api/service-centers")
            data = profiles.filter((p) => p.role === "service_center");
          else if (url.pathname === "/api/chain/participant") {
            const found = profiles.find(
              (p) =>
                p.id === url.searchParams.get("id") ||
                p.wallet_address ===
                  url.searchParams.get("wallet")?.toLowerCase(),
            );
            if (!found) throw new Error("Unknown participant");
            data = {
              ...found,
              chain_role: await client.readContract({
                address: products,
                abi: productAbi,
                functionName: "roles",
                args: [found.wallet_address as Address],
              }),
            };
          } else if (url.pathname === "/api/chain/private-payload") {
            const input = route.request().postDataJSON();
            const payload = {
              ...input,
              chain_id: 31337,
              contract_address: products.toLowerCase(),
              author_wallet: profile.wallet_address,
              nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
            };
            const commitment = payloadCommitment(payload);
            const inserted = await db
              .from("dapp_demo_private_payloads")
              .insert({ ...payload, commitment });
            if (inserted.error) throw inserted.error;
            data = { commitment };
          } else throw new Error(`Unexpected fixture request: ${url.pathname}`);
          await route.fulfill({ json: { data } });
        } catch (error) {
          await route.fulfill({
            status: 500,
            json: {
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : JSON.stringify(error),
              },
            },
          });
        }
      });
      return page;
    }
    const manufacturer = await participantPage(0, true),
      retailer = await participantPage(1),
      buyer = await participantPage(2),
      center = await participantPage(4);
    await manufacturer.goto("/products/new");
    await expect(
      manufacturer.getByRole("button", {
        name: "Activate Manufacturer", exact: true,
      }),
    ).toBeDisabled();
    await manufacturer.evaluate(() =>
      window.dispatchEvent(new Event("product-test-provider-ready")),
    );
    await manufacturer
      .getByRole("button", { name: "Activate Manufacturer", exact: true })
      .click();
    await expect(
      manufacturer.getByText(/Manufacturer role active/),
    ).toBeVisible();
    await manufacturer.getByLabel("Product model").fill("Demo headphones");
    await manufacturer
      .getByLabel("Serial number", { exact: true })
      .fill("COURSE-UI-001");
    await manufacturer
      .getByRole("button", { name: "Register product", exact: true })
      .click();
    await expect(manufacturer).toHaveURL(/\/products\/[0-9a-f-]+$/);
    const id = new URL(manufacturer.url()).pathname.split("/").at(-1)!;
    await manufacturer
      .getByLabel("Recipient wallet", { exact: true })
      .fill(addresses[1]);
    await manufacturer
      .getByRole("button", { name: "Initiate transfer", exact: true })
      .click();
    await expect(
      manufacturer.getByText(
        "Transfer sent. Ownership changes when the recipient accepts it.",
      ),
    ).toBeVisible();
    await retailer.goto("/transfers");
    await retailer.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(
      retailer.getByText(
        "Transfer accepted. The product now belongs to your wallet.",
      ),
    ).toBeVisible();
    await retailer.goto(`/products/${id}`);
    await retailer.getByLabel("Handover type").selectOption("paid");
    await retailer.getByLabel("Fixed PDC price").fill("100");
    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
    await retailer
      .getByLabel("Offer expires", { exact: true })
      .fill(tomorrow.toISOString().slice(0, 16));
    await retailer
      .getByLabel("Recipient wallet", { exact: true })
      .fill(addresses[2]);
    await retailer
      .getByRole("button", { name: "Initiate transfer", exact: true })
      .click();
    await expect(
      retailer.getByText(
        "Transfer sent. Ownership changes when the recipient accepts it.",
      ),
    ).toBeVisible();
    await buyer.goto("/transfers");
    await buyer
      .getByRole("button", { name: "Review PDC payment", exact: true })
      .click();
    await buyer
      .getByRole("button", { name: "Approve 100 PDC", exact: true })
      .click();
    await expect(
      buyer.getByRole("button", {
        name: "Pay 100 PDC and accept",
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      (
        await client.readContract({
          address: products,
          abi: productAbi,
          functionName: "getProduct",
          args: [productHex(id)],
        })
      ).owner.toLowerCase(),
    ).toBe(addresses[1].toLowerCase());
    await buyer
      .getByRole("button", { name: "Pay 100 PDC and accept", exact: true })
      .click();
    await expect(
      buyer.getByRole("alert").filter({ hasText: "is confirmed" }),
    ).toBeVisible();
    await expect(
      buyer.getByText(
        "Transfer accepted. The product now belongs to your wallet.",
      ),
    ).toHaveCount(0);
    await buyer
      .getByRole("button", { name: "Pay 100 PDC and accept", exact: true })
      .click();
    await expect(
      buyer.getByRole("alert").filter({ hasText: "already resolved" }),
    ).toBeVisible();
    await buyer
      .getByRole("button", { name: "Sync products", exact: true })
      .click();
    await expect(
      buyer.getByText(
        "Confirmed events are synchronized. Reload this page to refresh your products.",
      ),
    ).toBeVisible();
    await buyer.reload();
    await expect(buyer.getByText("accepted", { exact: true })).toBeVisible();
    expect(
      await client.readContract({
        address: pdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [addresses[1]],
      }),
    ).toBe(parseEther("100"));
    const bought = await client.readContract({
      address: products,
      abi: productAbi,
      functionName: "getProduct",
      args: [productHex(id)],
    });
    expect(bought.owner.toLowerCase()).toBe(addresses[2].toLowerCase());
    expect(bought.warrantyStarted).toBeGreaterThan(0n);
    await buyer.goto(`/products/${id}`);
    await buyer
      .getByRole("tab", { name: "Ownership History", exact: true })
      .click();
    await expect(
      buyer.getByText("Settled 100 PDC", { exact: true }),
    ).toBeVisible();
    await buyer.getByRole("tab", { name: "Warranty", exact: true }).click();
    await buyer
      .getByLabel("Service center", { exact: true })
      .selectOption(profiles[4].id);
    await buyer
      .getByLabel(/Describe the issue/i)
      .fill("Battery does not charge");
    await buyer
      .getByRole("button", { name: "Submit warranty request", exact: true })
      .click();
    await expect(
      buyer.getByText(
        "Warranty request submitted to your selected service center.",
      ),
    ).toBeVisible();
    await center.goto("/claims");
    await center
      .getByRole("button", { name: "Approve request", exact: true })
      .click();
    await center
      .getByRole("button", { name: "Record completed repair", exact: true })
      .click();
    expect(
      (
        await client.readContract({
          address: products,
          abi: productAbi,
          functionName: "getProduct",
          args: [productHex(id)],
        })
      ).claimsUsed,
    ).toBe(0);
    await center
      .getByLabel("Repair performed & outcome")
      .fill("Battery replaced and charging tested.");
    await center
      .getByRole("button", { name: "Complete & record repair", exact: true })
      .click();
    await expect(
      center.getByText(
        "Repair completed and recorded. One service claim has been used.",
      ),
    ).toBeVisible();
    expect(
      (
        await client.readContract({
          address: products,
          abi: productAbi,
          functionName: "getProduct",
          args: [productHex(id)],
        })
      ).claimsUsed,
    ).toBe(1);
    await buyer.goto(`/products/${id}`);
    await buyer
      .getByRole("tab", { name: "Service Records", exact: true })
      .click();
    await expect(
      buyer.getByText("Battery replaced and charging tested.", { exact: true }),
    ).toBeVisible();
    await buyer.setViewportSize({ width: 390, height: 844 });
    await expect(buyer.locator(".sidebar")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, -270, 0)",
    );
    await buyer.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, 0);
    });
    await expect.poll(() => buyer.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => buyer.locator(".mobile-header").evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(0);
    expect(
      await buyer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await buyer.screenshot({
      path: "test-results/product-settlement-mobile.png",
      fullPage: false,
    });
  } finally {
    for (const context of contexts) await context.close();
    await pg.close();
    await server.close();
  }
});
