import { describe, expect, it } from "vitest";
import { isDatabaseUnavailable } from "../../src/infrastructure/databaseAvailability";

const withCode = (code: string) => Object.assign(new Error(code), { code });

describe("isDatabaseUnavailable", () => {
  it.each([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "PROTOCOL_CONNECTION_LOST",
    "ER_CON_COUNT_ERROR",
  ])("is true for %s", (code) => {
    expect(isDatabaseUnavailable(withCode(code))).toBe(true);
  });

  it("looks inside AggregateError entries and causes", () => {
    expect(isDatabaseUnavailable(new AggregateError([withCode("ECONNREFUSED")], ""))).toBe(true);
    expect(isDatabaseUnavailable(new Error("x", { cause: withCode("ETIMEDOUT") }))).toBe(true);
  });

  it("is false for query errors and non-errors", () => {
    expect(isDatabaseUnavailable(withCode("ER_DUP_ENTRY"))).toBe(false);
    expect(isDatabaseUnavailable(new Error("plain"))).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });
});
