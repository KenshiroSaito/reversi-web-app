import { FullConfig } from "@playwright/test";
import { assertTestDatabase } from "../support/testDatabase";
import { rebuildTestDatabase } from "../integration/globalSetup";

export default async function globalSetup(config: FullConfig): Promise<void> {
  // Check the environment the app will actually start with.
  const webServers = config.webServer ? [config.webServer] : [];
  for (const server of webServers) {
    assertTestDatabase({ ...process.env, ...(server.env ?? {}) });
  }
  if (webServers.length === 0) {
    throw new Error("The e2e suite must start its own app (webServer)");
  }
  await rebuildTestDatabase();
}
