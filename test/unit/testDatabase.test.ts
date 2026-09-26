import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "../support/testDatabase";

const env = { DB_HOST: "localhost", DB_USER: "reversi", DB_PASSWORD: "password" };

describe("assertTestDatabase", () => {
  it("accepts reversi_test", () => {
    expect(() => assertTestDatabase({ ...env, DB_NAME: "reversi_test" })).not.toThrow();
  });

  it.each(["reversi", "reversi_preview", "reversi_test2"])("refuses %s", (name) => {
    expect(() => assertTestDatabase({ ...env, DB_NAME: name })).toThrow("Refusing");
  });
});
