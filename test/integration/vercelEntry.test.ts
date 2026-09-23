import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../../api/index";
import { closePool } from "../../src/infrastructure/connection";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closePool();
});

describe("Vercel entry point", () => {
  it("serves the API through the default export", async () => {
    const created = await fetch(`${baseUrl}/api/games`, { method: "POST" });
    expect(created.status).toBe(201);

    const listed = await fetch(`${baseUrl}/api/games`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { games: unknown[] };
    expect(body.games.length).toBeGreaterThan(0);
  });
});
