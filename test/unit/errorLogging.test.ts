import { describe, expect, it } from "vitest";
import { describeError } from "../../src/presentation/errorLogging";

describe("describeError", () => {
  it("keeps diagnostic fields and drops the SQL text", () => {
    const err = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sqlState: "23000",
      sql: "insert into players (token_hash) values ('secret-value')",
    });

    const described = describeError(err);

    expect(described).toMatchObject({
      name: "Error",
      message: "Duplicate entry",
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sqlState: "23000",
    });
    expect(described.stack).toContain("Duplicate entry");
    expect(JSON.stringify(described)).not.toContain("secret-value");
  });

  it("describes nested causes and AggregateError entries", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED ::1:3306"), { code: "ECONNREFUSED" });
    const aggregate = Object.assign(new AggregateError([inner], ""), { code: "ECONNREFUSED" });
    const outer = new Error("wrapped", { cause: aggregate });

    const described = describeError(outer);

    expect(described.cause?.code).toBe("ECONNREFUSED");
    expect(described.cause?.errors?.[0].message).toBe("connect ECONNREFUSED ::1:3306");
  });

  it("handles non-Error values", () => {
    expect(describeError("boom")).toEqual({ message: "boom" });
    expect(describeError(undefined)).toEqual({ message: "undefined" });
  });
});
