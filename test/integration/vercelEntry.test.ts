import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../../api/index";
import { closePool } from "../../src/infrastructure/connection";
import { Guest, startTestServer, TestServer } from "./apiClient";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer(handler);
});

afterAll(async () => {
  await server.close();
  await closePool();
});

describe("Vercel entry point", () => {
  it("serves the API through the default export", async () => {
    const guest = new Guest(server);

    const created = await guest.post("/api/games");
    expect(created.status).toBe(201);

    const listed = await guest.get("/api/games");
    expect(listed.status).toBe(200);
    expect(listed.body.games.length).toBeGreaterThan(0);
  });
});
