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
  parseAbi,
  getAddress,
  type Abi,
  type Address,
} from "viem";

test("demo wallet and AMM execute real transfers, swaps and LP transactions", async ({
  page,
}) => {
  test.setTimeout(120_000);
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
  const accounts = await createWalletClient({
    chain,
    transport: http(rpcUrl),
  }).getAddresses();
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
  let amm: Record<string, Address> = {};
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
            pdc: getAddress(tokens[0]),
            pdq: getAddress(tokens[1]),
            treasury: accounts[0],
            fromBlock: "0",
            rpcUrl,
            productBackend: "database",
            ...amm,
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
    await expect(page.locator(".sidebar")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, -270, 0)",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/demo-wallet-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    async function deployArtifact(path: string, args: readonly unknown[] = []) {
      const artifact = JSON.parse(
        await readFile(`node_modules/${path}`, "utf8"),
      );
      const receipt = await client.waitForTransactionReceipt({
        hash: await signer.deployContract({
          abi: artifact.abi,
          bytecode: artifact.bytecode.startsWith("0x")
            ? artifact.bytecode
            : `0x${artifact.bytecode}`,
          args,
        }),
      });
      return getAddress(receipt.contractAddress!);
    }
    async function execute(
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
        account: signer.account,
      });
      return client.waitForTransactionReceipt({
        hash: await signer.writeContract(request),
      });
    }
    const factory = await deployArtifact(
      "@uniswap/v2-core/build/UniswapV2Factory.json",
      [accounts[0]],
    );
    const weth = await deployArtifact("@uniswap/v2-periphery/build/WETH9.json");
    const router = await deployArtifact(
      "@uniswap/v2-periphery/build/UniswapV2Router02.json",
      [factory, weth],
    );
    const factoryAbi = parseAbi([
      "function createPair(address,address) returns (address)",
      "function getPair(address,address) view returns (address)",
    ]);
    await execute(factory, factoryAbi, "createPair", tokens);
    const pair = getAddress(
      await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "getPair",
        args: [tokens[0], tokens[1]],
      }),
    );
    const routerAbi = parseAbi([
      "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
    ]);
    for (const token of tokens)
      await execute(token, erc20Abi, "approve", [router, parseEther("100000")]);
    await execute(router, routerAbi, "addLiquidity", [
      ...tokens,
      parseEther("100000"),
      parseEther("100000"),
      parseEther("100000"),
      parseEther("100000"),
      accounts[0],
      (await client.getBlock()).timestamp + 600n,
    ]);
    amm = { factory, weth, router, pair };
    const lpBefore = await client.readContract({
      address: pair,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [accounts[0]],
    });
    await page.goto("/liquidity");
    await page.getByLabel("PDC amount", { exact: true }).fill("100");
    await page
      .getByRole("button", { name: "Review liquidity", exact: true })
      .click();
    await page.getByRole("button", { name: /Approve 100 PDC/ }).click();
    await page.getByRole("button", { name: /Approve 100 PDQ/ }).click();
    await page
      .getByRole("button", { name: "Confirm deposit", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Add liquidity confirmed on chain",
      { timeout: 30_000 },
    );
    expect(
      await client.readContract({
        address: pair,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [accounts[0]],
      }),
    ).toBe(lpBefore + parseEther("100"));
    await page.goto("/exchange");
    await page.getByLabel("Amount to sell").fill("1000");
    await page
      .getByRole("button", { name: "Review exchange", exact: true })
      .click();
    await page.getByRole("button", { name: /Approve 1000 PDC/ }).click();
    await expect(
      page.getByRole("button", { name: "Confirm exchange", exact: true }),
    ).toBeEnabled();
    const pdqBefore = await client.readContract({
      address: tokens[1],
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [accounts[0]],
    });
    const countBefore = submissions;
    await page
      .getByRole("button", { name: "Confirm exchange", exact: true })
      .click({ clickCount: 2 });
    await expect(page.getByRole("status")).toContainText(
      "Exchange PDC for PDQ confirmed on chain",
      { timeout: 30_000 },
    );
    expect(submissions - countBefore).toBe(1);
    expect(
      await client.readContract({
        address: tokens[1],
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [accounts[0]],
      }),
    ).toBeGreaterThan(pdqBefore);
    await page.goto("/liquidity");
    await page.getByLabel("Action", { exact: true }).selectOption("remove");
    await page
      .getByRole("button", { name: "Review liquidity", exact: true })
      .click();
    await page.getByRole("button", { name: /Approve .* LP/ }).click();
    await page
      .getByRole("button", { name: "Confirm withdrawal", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Remove liquidity confirmed on chain",
      { timeout: 30_000 },
    );
    expect(
      await client.readContract({
        address: pair,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [accounts[0]],
      }),
    ).toBeLessThan(lpBefore);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".sidebar")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, -270, 0)",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/demo-liquidity-mobile.png",
      fullPage: true,
    });
  } finally {
    await server.close();
  }
});
