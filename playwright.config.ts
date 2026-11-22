import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
const testData = resolve(".test-data", randomUUID());
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3003",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --port 3003",
    url: "http://localhost:3003",
    reuseExistingServer: false,
    env: {
      CHAIN_ENABLED: "0",
      LOCAL_DATABASE_PATH: resolve(testData, "e2e.sqlite"),
      LOCAL_UPLOAD_DIR: resolve(testData, "uploads"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    timeout: 60000,
  },
});
