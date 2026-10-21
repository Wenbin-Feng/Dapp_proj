import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentSchema } from "../src/lib/chain/config";
import deployed from "../config/demo-chain.sepolia.json";

const script = fileURLToPath(new URL("../scripts/prepare-demo-production.mjs", import.meta.url));
const folders: string[] = [];
const original = "SUPABASE_SECRET_KEY=fixture_secret_keep_local\nPRODUCT_BACKEND=chain\n";
async function run(backend = "", github = true) {
  const folder = await mkdtemp(join(tmpdir(), "dapp-production-config-"));
  folders.push(folder);
  await mkdir(join(folder, ".vercel"));
  await writeFile(join(folder, ".vercel/.env.production.local"), original);
  const result = spawnSync(process.execPath, [script], {
    cwd: folder,
    env: { ...process.env, PRODUCT_BACKEND: backend, GITHUB_ENV: github ? join(folder, "github.env") : "" },
    encoding: "utf8",
  });
  expect(result.stdout + result.stderr).not.toContain("fixture_secret_keep_local");
  return { folder, result, production: await readFile(join(folder, ".vercel/.env.production.local"), "utf8") };
}
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    expect(dirname(resolve(folder))).toBe(resolve(tmpdir()));
    expect(basename(folder)).toMatch(/^dapp-production-config-/);
    await rm(folder, { recursive: true, force: true });
  }
});

it("configures the actual deployment for build and runtime without copying Supabase secrets", async () => {
  const { folder, result, production } = await run();
  expect(result.status, result.stderr).toBe(0);
  const github = await readFile(join(folder, "github.env"), "utf8");
  const values = Object.fromEntries(github.trim().split("\n").map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  expect(deploymentSchema.parse(JSON.parse(values.DEMO_DEPLOYMENT))).toEqual(deploymentSchema.parse(deployed));
  expect(values.DEMO_PUBLIC_RPC_URL).toBe(new URL(deployed.rpcUrl).href);
  expect(values.PRODUCT_BACKEND).toBe("database");
  expect(production.startsWith(original)).toBe(true);
  expect(production.endsWith(github)).toBe(true);
  expect(Object.keys(values).sort()).toEqual(["DEMO_DEPLOYMENT", "DEMO_PUBLIC_RPC_URL", "PRODUCT_BACKEND"]);
});
it("enables the chain product backend only with the explicit Actions variable", async () => {
  const { result, production } = await run("chain");
  expect(result.status, result.stderr).toBe(0);
  expect(production.endsWith("PRODUCT_BACKEND=chain\n")).toBe(true);
});
it("rejects invalid backend settings before modifying production configuration", async () => {
  const { result, production } = await run("invalid");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("PRODUCT_BACKEND must be database or chain");
  expect(production).toBe(original);
});
it("requires the Actions runtime output file before modifying production configuration", async () => {
  const { result, production } = await run("", false);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Run this script in GitHub Actions after vercel pull");
  expect(production).toBe(original);
});
