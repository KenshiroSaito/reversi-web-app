import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Same local settings as npm start; DB_NAME is overridden below.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const BASE_URL = "http://localhost:3000";

// The app under test always uses reversi_test: a variable set in the process
// environment wins over the same one in .env (loaded by --env-file).
const serverEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    serverEnv[key] = value;
  }
}
serverEnv.DB_NAME = "reversi_test";

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "*.spec.ts",
  // The specs share reversi_test; run them one at a time.
  workers: 1,
  fullyParallel: false,
  globalSetup: "./test/e2e/globalSetup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --env-file=.env -r ts-node/register src/main.ts",
    url: `${BASE_URL}/`,
    env: serverEnv,
    // Never reuse a server already on port 3000: it may be a dev server
    // pointing at the reversi database.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
