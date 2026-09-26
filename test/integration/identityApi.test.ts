import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/main";
import { closePool } from "../../src/infrastructure/connection";
import { RegisterGuestUseCase } from "../../src/application/useCase/registerGuestUseCase";
import { PlayerMYSQLRepository } from "../../src/infrastructure/repository/player/playerMYSQLRepository";
import { RateLimitMySQLQueryService } from "../../src/infrastructure/query/rateLimitMYSQLQueryService";
import { generatePlayerToken } from "../../src/application/identity/playerToken";
import { Guest, startTestServer, TestServer } from "./apiClient";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer(app);
});

afterAll(async () => {
  await server.close();
  await closePool();
});

describe("GET /api/me", () => {
  it("returns 404 without a cookie", async () => {
    const response = await new Guest(server).get("/api/me");

    expect(response.status).toBe(404);
    expect(response.body.type).toBe("PlayerNotFound");
  });

  it("returns the guest's display name with a valid cookie", async () => {
    const registered = await new RegisterGuestUseCase(
      new PlayerMYSQLRepository(),
      new RateLimitMySQLQueryService(),
    ).run(randomBytes(32));
    const guest = new Guest(server);
    guest.cookie = `rv_player=${registered.token}`;

    const response = await guest.get("/api/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ displayName: registered.player.displayName });
  });

  it.each([
    ["a garbage value", "not-a-token; drop table players"],
    ["a well-formed token with no player", generatePlayerToken()],
  ])("treats %s as no cookie", async (_label, value) => {
    const guest = new Guest(server);
    guest.cookie = `rv_player=${encodeURIComponent(value)}`;

    const response = await guest.get("/api/me");

    expect(response.status).toBe(404);
    expect(response.body.type).toBe("PlayerNotFound");
  });
});
