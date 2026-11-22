import { defineConfig, devices } from "@playwright/test";
import { dirname, resolve } from "node:path";
process.env.CHAIN_E2E = "1";
process.env.TEST_APP_ORIGIN = "http://localhost:3002";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "wallet-login.spec.ts",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.TEST_APP_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --port 3002",
    url: process.env.TEST_APP_ORIGIN,
    reuseExistingServer: false,
    timeout: 90000,
    env: {
      CHAIN_ENABLED: "1",
      CHAIN_DEPLOYMENT_FILE: process.env.CHAIN_DEPLOYMENT_FILE!,
      CHAIN_RPC_URL: process.env.CHAIN_RPC_URL!,
      LOCAL_UPLOAD_DIR: resolve(
        dirname(process.env.CHAIN_DEPLOYMENT_FILE!),
        "uploads",
      ),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
