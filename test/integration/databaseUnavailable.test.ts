import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../../src/main";
import { closePool } from "../../src/infrastructure/connection";
import { Guest, startTestServer, TestServer } from "./apiClient";

let server: TestServer;

beforeAll(async () => {
  // The pool is created on first use, so this redirects it to a closed port.
  vi.stubEnv("DB_HOST", "127.0.0.1");
  vi.stubEnv("DB_PORT", "1");
  server = await startTestServer(app);
});

afterAll(async () => {
  await server.close();
  await closePool();
  vi.unstubAllEnvs();
});

describe("when the database is unreachable", () => {
  it("returns 503 and logs the underlying error code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await new Guest(server).post("/api/games");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ type: "ServiceUnavailable", message: "Service temporarily unavailable" });
    expect(error.mock.calls.flat().join(" ")).toContain("ECONNREFUSED");
    error.mockRestore();
  });
});
