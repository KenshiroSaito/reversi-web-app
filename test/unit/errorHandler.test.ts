import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../src/presentation/errorHandler";
import { DomainError } from "../../src/domain/error/domainError";
import { ApplicationError } from "../../src/application/error/applicationError";
import { SchemaOutOfDateError } from "../../src/infrastructure/migration/schemaCheck";

interface FakeResponse {
  statusCode: number;
  body: unknown;
}

function run(err: unknown): FakeResponse {
  const result: FakeResponse = { statusCode: 0, body: undefined };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
    send(body: unknown) {
      result.body = body;
      return res;
    },
  };
  const req = { method: "POST", path: "/api/games" };
  errorHandler(err, req as express.Request, res as unknown as express.Response, () => {});
  return result;
}

let logged: string;

beforeEach(() => {
  logged = "";
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged += args.map(String).join(" ");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorHandler", () => {
  it("maps DomainError to 400 without logging", () => {
    expect(run(new DomainError("FlipPointsIsEmpty", "Flip points is empty"))).toEqual({
      statusCode: 400,
      body: { type: "FlipPointsIsEmpty", message: "Flip points is empty" },
    });
    expect(logged).toBe("");
  });

  it("maps ApplicationError by type", () => {
    expect(run(new ApplicationError("GameNotFound", "Game not found")).statusCode).toBe(404);
    expect(run(new ApplicationError("StaleTurn", "stale")).statusCode).toBe(409);
    expect(run(new ApplicationError("GameCreationLimitReached", "slow down")).statusCode).toBe(429);
  });

  it("maps body-parser client errors to 400 InvalidRequest", () => {
    const err = Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
      status: 400,
      expose: true,
    });
    expect(run(err)).toEqual({
      statusCode: 400,
      body: { type: "InvalidRequest", message: "Request body is not valid JSON" },
    });
  });

  it("maps other client-caused request errors to their 4xx status without logging", () => {
    // Express rejects an undecodable path parameter (%E0) with status 400 but no `expose`.
    const badPath = Object.assign(new URIError("Failed to decode param '%E0'"), { status: 400, statusCode: 400 });
    const tooLarge = Object.assign(new Error("request entity too large"), { type: "entity.too.large", status: 413, expose: true });
    const badCharset = Object.assign(new Error("unsupported charset"), { type: "charset.unsupported", status: 415, expose: true });

    expect(run(badPath)).toEqual({ statusCode: 400, body: { type: "InvalidRequest", message: "Invalid request" } });
    expect(run(tooLarge)).toEqual({
      statusCode: 413,
      body: { type: "InvalidRequest", message: "Request body is too large" },
    });
    expect(run(badCharset)).toEqual({
      statusCode: 415,
      body: { type: "InvalidRequest", message: "Unsupported request body encoding" },
    });
    expect(logged).toBe("");
  });

  it("returns 503 and logs the missing migrations", () => {
    const response = run(new SchemaOutOfDateError(["001_create_players_and_game_players"]));

    expect(response).toEqual({
      statusCode: 503,
      body: { type: "ServiceUnavailable", message: "Service temporarily unavailable" },
    });
    expect(logged).toContain("001_create_players_and_game_players");
  });

  it("returns 503 and logs the code when the database is unreachable", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED ::1:3306"), { code: "ECONNREFUSED" });
    const response = run(Object.assign(new AggregateError([refused], ""), { code: "ECONNREFUSED" }));

    expect(response.statusCode).toBe(503);
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).toContain("/api/games");
  });

  it("returns the generic 500 body and logs the real cause, without SQL", () => {
    const err = Object.assign(new Error("Unknown column 'x'"), { sql: "select 'secret-value'" });
    const response = run(err);

    expect(response).toEqual({ statusCode: 500, body: { message: "Unexpected Error occured" } });
    expect(logged).toContain("Unknown column 'x'");
    expect(logged).not.toContain("secret-value");
  });
});
