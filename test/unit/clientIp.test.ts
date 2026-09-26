import express from "express";
import { describe, expect, it } from "vitest";
import { clientIpOf, hashClientIp } from "../../src/presentation/identity/clientIp";

function request(headers: Record<string, string>, remoteAddress = "10.0.0.5"): express.Request {
  return { headers, socket: { remoteAddress } } as unknown as express.Request;
}

describe("clientIpOf", () => {
  it("uses x-real-ip on Vercel", () => {
    expect(clientIpOf(request({ "x-real-ip": "203.0.113.7" }), true)).toBe("203.0.113.7");
  });

  it("ignores forwarding headers outside Vercel", () => {
    const req = request({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" });
    expect(clientIpOf(req, false)).toBe("10.0.0.5");
  });

  it("falls back to the socket address when the header is missing", () => {
    expect(clientIpOf(request({}), true)).toBe("10.0.0.5");
  });
});

describe("hashClientIp", () => {
  it("is deterministic for one secret and differs across secrets", () => {
    expect(hashClientIp("203.0.113.7", "a").equals(hashClientIp("203.0.113.7", "a"))).toBe(true);
    expect(hashClientIp("203.0.113.7", "a").equals(hashClientIp("203.0.113.7", "b"))).toBe(false);
    expect(hashClientIp("203.0.113.7", "a")).toHaveLength(32);
  });
});
