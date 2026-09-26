import express from "express";
import { describe, expect, it } from "vitest";
import { csrfProtection, CsrfRejectedError } from "../../src/presentation/middleware/csrfProtection";

function check(method: string, headers: Record<string, string>, protocol = "http"): unknown {
  const req = {
    method,
    protocol,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as express.Request;
  let passed: unknown = "not called";
  csrfProtection(req, {} as express.Response, (err?: unknown) => {
    passed = err;
  });
  return passed;
}

const sameOrigin = { host: "localhost:3000", origin: "http://localhost:3000", "x-requested-with": "reversi" };

describe("csrfProtection", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("lets %s through without checks", (method) => {
    expect(check(method, {})).toBeUndefined();
  });

  it("accepts a same-origin POST with the header", () => {
    expect(check("POST", sameOrigin)).toBeUndefined();
  });

  it("uses x-forwarded-proto behind Vercel", () => {
    const headers = { ...sameOrigin, origin: "https://reversi.example", host: "reversi.example", "x-forwarded-proto": "https" };
    expect(check("POST", headers)).toBeUndefined();
  });

  it.each([
    ["without the header", { host: "localhost:3000", origin: "http://localhost:3000" }],
    ["with a wrong header value", { ...sameOrigin, "x-requested-with": "XMLHttpRequest" }],
    ["without an Origin", { host: "localhost:3000", "x-requested-with": "reversi" }],
    ["from another origin", { ...sameOrigin, origin: "http://evil.example" }],
    ["from another port", { ...sameOrigin, origin: "http://localhost:4000" }],
    ["from another scheme", { ...sameOrigin, origin: "https://localhost:3000" }],
  ])("rejects a POST %s", (_label, headers) => {
    expect(check("POST", headers)).toBeInstanceOf(CsrfRejectedError);
  });
});
