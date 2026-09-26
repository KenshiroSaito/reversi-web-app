import { describe, expect, it } from "vitest";
import { assertSafeTarget, formatCliError, parseMigrateArgs } from "../../src/infrastructure/migration/migrateCli";

describe("formatCliError", () => {
  it("names the code when the error message is empty, as for a refused localhost connection", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED ::1:3306"), { code: "ECONNREFUSED" });
    const aggregate = Object.assign(new AggregateError([refused], ""), { code: "ECONNREFUSED" });

    const text = formatCliError(aggregate);

    expect(text).toContain("ECONNREFUSED");
    expect(text).toContain("connect ECONNREFUSED ::1:3306");
  });

  it("prints a plain message as-is", () => {
    expect(formatCliError(new Error("--database x does not match DB_NAME y"))).toBe(
      "--database x does not match DB_NAME y",
    );
  });
});

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
