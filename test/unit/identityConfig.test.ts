import { describe, expect, it } from "vitest";
import { loadIdentityConfig } from "../../src/presentation/identity/identityConfig";

describe("loadIdentityConfig", () => {
  it("requires IP_HASH_SECRET", () => {
    expect(() => loadIdentityConfig({})).toThrow("IP_HASH_SECRET");
  });

  it("accepts a short secret locally", () => {
    expect(loadIdentityConfig({ IP_HASH_SECRET: "dev" })).toEqual({ ipHashSecret: "dev", onVercel: false });
  });

  it("requires 32 characters on Vercel and never echoes the value", () => {
    let message = "";
    try {
      loadIdentityConfig({ VERCEL: "1", IP_HASH_SECRET: "too-short-secret" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("at least 32");
    expect(message).not.toContain("too-short-secret");
  });

  it("accepts a long secret on Vercel", () => {
    const secret = "x".repeat(32);
    expect(loadIdentityConfig({ VERCEL: "1", IP_HASH_SECRET: secret })).toEqual({
      ipHashSecret: secret,
      onVercel: true,
    });
  });
});
