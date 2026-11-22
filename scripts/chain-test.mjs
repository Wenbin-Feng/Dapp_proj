import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
const dir = resolve(".test-data", "chain-" + randomUUID());
await mkdir(dir, { recursive: true });
const log = await open(resolve(dir, "node.log"), "w");
const env = {
  ...process.env,
  CHAIN_ENABLED: "1",
  CHAIN_RPC_URL: "http://127.0.0.1:18545",
  CHAIN_DEPLOYMENT_FILE: resolve(dir, "deployment.json"),
  NEXT_TELEMETRY_DISABLED: "1",
};
async function run(args) {
  const child = spawn(process.execPath, args, {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw Error(`Command failed (${code}): ${args.join(" ")}`);
}
let node;
try {
  // Refuse to reuse somebody else's node; tests intentionally alter chain time.
  const occupied = await fetch(env.CHAIN_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
    signal: AbortSignal.timeout(500),
  })
    .then(() => true)
    .catch(() => false);
  if (occupied)
    throw Error(
      "Port 18545 is occupied; stop the previous isolated test node first.",
    );
  await run(["scripts/chain-compile.mjs"]);
  node = spawn(
    process.execPath,
    [
      "node_modules/hardhat/dist/src/cli.js",
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18545",
    ],
    { env, stdio: ["ignore", log.fd, log.fd], windowsHide: true },
  );
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (node.exitCode !== null)
      throw Error(`Test node exited; inspect ${dir}/node.log`);
    try {
      const response = await fetch(env.CHAIN_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
        signal: AbortSignal.timeout(500),
      });
      if ((await response.json()).result === "0x7a69") {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw Error("Test node did not become ready.");
  await run(["scripts/chain-deploy.mjs"]);
  if (process.argv.includes("--browser"))
    await run([
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      "playwright.chain.config.ts",
    ]);
  else
    await run([
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.chain.config.ts",
    ]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (node) {
    node.kill();
    await new Promise((r) =>
      node.exitCode !== null ? r() : node.once("exit", r),
    );
  }
  await log.close();
}
