import { describe, expect, it } from "vitest";
import { assertSafeTarget, parseMigrateArgs } from "../../src/infrastructure/migration/migrateCli";

describe("parseMigrateArgs", () => {
  it("reads --env-file and --database", () => {
    expect(parseMigrateArgs(["--env-file", ".env.preview", "--database", "reversi_preview"])).toEqual({
      envFile: ".env.preview",
      database: "reversi_preview",
    });
  });

  it("rejects unknown flags and missing values", () => {
    expect(() => parseMigrateArgs(["--force"])).toThrow("--force");
    expect(() => parseMigrateArgs(["--database"])).toThrow("--database");
  });
});

describe("assertSafeTarget", () => {
  const local = { host: "localhost", database: "reversi_test" };

  it("requires --database", () => {
    expect(() => assertSafeTarget({}, local)).toThrow("--database");
  });

  it("requires --database to match DB_NAME", () => {
    expect(() => assertSafeTarget({ database: "reversi" }, local)).toThrow("does not match");
  });

  it("accepts a matching local target without TLS", () => {
    expect(() => assertSafeTarget({ database: "reversi_test" }, local)).not.toThrow();
  });

  it("refuses a remote host without TLS", () => {
    const remote = { host: "mysql-xyz.aivencloud.com", database: "reversi_preview" };
    expect(() => assertSafeTarget({ database: "reversi_preview" }, remote)).toThrow("DB_CA_CERT");
  });

  it("accepts a remote host with TLS", () => {
    const remote = {
      host: "mysql-xyz.aivencloud.com",
      database: "reversi_preview",
      ssl: { ca: "pem", rejectUnauthorized: true },
    };
    expect(() => assertSafeTarget({ database: "reversi_preview" }, remote)).not.toThrow();
  });
});
