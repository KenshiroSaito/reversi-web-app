import { describe, expect, it } from "vitest";
import { IDLE_TIMEOUT_MS, loadDbConfig } from "../../src/infrastructure/dbConfig";

const baseEnv = {
  DB_HOST: "db.example.com",
  DB_USER: "app",
  DB_PASSWORD: "s3cret-value",
  DB_NAME: "reversi",
};

describe("loadDbConfig", () => {
  it("builds pool options from the environment with defaults", () => {
    expect(loadDbConfig(baseEnv)).toEqual({
      host: "db.example.com",
      port: 3306,
      user: "app",
      password: "s3cret-value",
      database: "reversi",
      ssl: undefined,
      connectionLimit: 3,
      maxIdle: 3,
      idleTimeout: IDLE_TIMEOUT_MS,
      waitForConnections: true,
      queueLimit: 0,
    });
  });

  it("uses DB_PORT and DB_POOL_MAX when set", () => {
    const options = loadDbConfig({ ...baseEnv, DB_PORT: "12345", DB_POOL_MAX: "5" });

    expect(options.port).toBe(12345);
    expect(options.connectionLimit).toBe(5);
    expect(options.maxIdle).toBe(5);
  });

  it.each(["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"])(
    "throws naming %s when it is missing",
    (name) => {
      const env: NodeJS.ProcessEnv = { ...baseEnv };
      delete env[name];

      expect(() => loadDbConfig(env)).toThrow(name);
    },
  );

  it("treats an empty required variable as missing", () => {
    expect(() => loadDbConfig({ ...baseEnv, DB_HOST: "" })).toThrow("DB_HOST");
  });

  it("never includes the password in error messages", () => {
    let message = "";
    try {
      loadDbConfig({ ...baseEnv, DB_NAME: undefined });
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("s3cret-value");
  });

  it.each([
    ["DB_PORT", "abc"],
    ["DB_PORT", "0"],
    ["DB_PORT", "3306.5"],
    ["DB_POOL_MAX", "-1"],
    ["DB_POOL_MAX", "two"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => loadDbConfig({ ...baseEnv, [name]: value })).toThrow(name);
  });

  it("enables verified TLS when DB_CA_CERT is set", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

    expect(loadDbConfig({ ...baseEnv, DB_CA_CERT: ca }).ssl).toEqual({
      ca,
      rejectUnauthorized: true,
    });
  });

  it("requires DB_CA_CERT when running on Vercel", () => {
    expect(() => loadDbConfig({ ...baseEnv, VERCEL: "1" })).toThrow("DB_CA_CERT");
  });

  it("accepts Vercel with DB_CA_CERT set", () => {
    const options = loadDbConfig({ ...baseEnv, VERCEL: "1", DB_CA_CERT: "pem" });

    expect(options.ssl).toEqual({ ca: "pem", rejectUnauthorized: true });
  });
});
