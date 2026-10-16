// Real Hardhat transactions; only identity restoration and the public deployment
// configuration are intercepted. No application authentication bypass is added.
import { test, expect } from "@playwright/test";
import { network } from "hardhat";
import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  erc20Abi,
  parseEther,
  type Address,
} from "viem";

test("demo wallet cancels safely, transfers on chain and restores receipt history", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const server = await network.createServer("hardhat", "127.0.0.1", 0);
  const { port } = await server.listen();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = defineChain({
    id: 31337,
    name: "Hardhat",
    nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const accounts = await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses();
  const signer = createWalletClient({
    account: accounts[0],
    chain,
    transport: http(rpcUrl),
  });
  const build = JSON.parse(
    await readFile("artifacts/contracts/DemoToken.sol/DemoToken.json", "utf8"),
  );
  const tokens: Address[] = [];
  let cancelled = true;
  let submissions = 0;
  try {
    for (const symbol of ["PDC", "PDQ"]) {
      const receipt = await client.waitForTransactionReceipt({
        hash: await signer.deployContract({
          abi: build.abi,
          bytecode: build.bytecode,
          args: [symbol, symbol, accounts[0]],
        }),
      });
      tokens.push(receipt.contractAddress!);
    }
    await page.exposeFunction(
      "demoWalletRpc",
      async (method: string, params: unknown[]) => {
        if (method === "eth_sendTransaction") {
          if (cancelled)
            return {
              error: { code: 4001, message: "User rejected the request." },
            };
          submissions++;
        }
        return { result: await client.request({ method, params } as never) };
      },
    );
    await page.addInitScript(
      ({ account }) => {
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
            const response = await (
              window as unknown as {
                demoWalletRpc: (
                  method: string,
                  params: unknown[],
                ) => Promise<{
                  error?: { code: number; message: string };
                  result?: unknown;
                }>;
              }
            ).demoWalletRpc(method, params);
            if (response.error)
              throw Object.assign(new Error(response.error.message), {
                code: response.error.code,
              });
            return response.result;
          },
          on() {},
          removeListener() {},
        };
        Object.defineProperty(window, "ethereum", {
          value: provider,
          configurable: true,
        });
      },
      { account: accounts[0] },
    );
    await page.route("**/api/me", (route) =>
      route.fulfill({
        json: {
          data: {
            wallet_address: accounts[0],
            profile: {
              id: "10000000-0000-4000-8000-000000000001",
              wallet_address: accounts[0],
              role: "customer",
              display_name: "Demo User",
              organization_name: null,
              onboarding_completed_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            },
          },
        },
      }),
    );
    await page.route("**/api/chain/config", (route) =>
      route.fulfill({
        json: {
          data: {
            version: "demo-v1",
            chainId: 31337,
            pdc: tokens[0],
            pdq: tokens[1],
            treasury: accounts[0],
            fromBlock: "0",
            rpcUrl,
            productBackend: "database",
          },
        },
      }),
    );
    await page.goto("/wallet");
    await expect(
      page.getByRole("heading", { name: "Your balances" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send PDC", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("Recipient address").fill(accounts[1]);
    await page
      .getByLabel("Amount", { exact: true })
      .fill("12.500000000000000001");
    await page.getByRole("button", { name: "Send PDC", exact: true }).click();
    await expect(page.getByRole("alert").first()).toContainText(
      /rejected|cancelled/i,
    );
    expect(submissions).toBe(0);
    cancelled = false;
    await page.getByRole("button", { name: "Send PDC", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Transfer PDC confirmed on chain",
      { timeout: 30_000 },
    );
    expect(submissions).toBe(1);
    expect(
      await client.readContract({
        address: tokens[0],
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [accounts[1]],
      }),
    ).toBe(parseEther("12.500000000000000001"));
    await page.reload();
    await expect(
      page.getByText("Transfer PDC · confirmed", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -270, 0)");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/demo-wallet-mobile.png",
      fullPage: true,
    });
  } finally {
    await server.close();
  }
});
