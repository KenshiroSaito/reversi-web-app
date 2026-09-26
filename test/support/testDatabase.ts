import { loadDbConfig } from "../../src/infrastructure/dbConfig";

export const TEST_DATABASE = "reversi_test";

/**
 * Stops a test run before it touches any database other than reversi_test,
 * whatever .env or the shell says.
 */
export function assertTestDatabase(env: NodeJS.ProcessEnv): void {
  const database = loadDbConfig(env).database;
  if (database !== TEST_DATABASE) {
    throw new Error(`Refusing to run tests against database "${database}"; expected "${TEST_DATABASE}"`);
  }
}
