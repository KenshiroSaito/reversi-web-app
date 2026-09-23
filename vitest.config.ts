import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Local database settings come from .env, the same file `npm start` uses.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          globalSetup: ["test/integration/globalSetup.ts"],
          // A dedicated database keeps the developer's data untouched, and a
          // single-connection pool turns any leaked connection into a hang,
          // which the test timeout reports as a failure.
          env: { DB_NAME: "reversi_test", DB_POOL_MAX: "1" },
          testTimeout: 5000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
