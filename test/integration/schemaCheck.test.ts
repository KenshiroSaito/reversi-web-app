import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { MIGRATIONS } from "../../src/infrastructure/migration/migrations";
import { SchemaOutOfDateError } from "../../src/infrastructure/migration/schemaCheck";
import { adminConnection } from "./helpers";

// DB_POOL_MAX=1: if a failed check kept its connection, the next call would hang.

let admin: mysql.Connection;

beforeAll(async () => {
  admin = await adminConnection();
  await admin.query("use reversi_test");
});

afterAll(async () => {
  await closePool();
  await admin.end();
});

describe("schema check", () => {
  it("rejects with the missing version, releases the connection, and recovers", async () => {
    await closePool();
    const version = MIGRATIONS[0].version;
    await admin.query("delete from schema_migrations where version = ?", [version]);
    try {
      await expect(connectMySQL()).rejects.toThrow(version);
      // Not cached, and the connection was released (pool of 1 would hang otherwise).
      await expect(connectMySQL()).rejects.toBeInstanceOf(SchemaOutOfDateError);
    } finally {
      await admin.query("insert into schema_migrations (version) values (?)", [version]);
    }

    const conn = await connectMySQL();
    await conn.end();
  });

  it("treats a database that was never migrated as missing every version", async () => {
    await closePool();
    await admin.query("rename table schema_migrations to schema_migrations_hidden");
    try {
      const error = await connectMySQL().catch((e) => e);
      expect(error).toBeInstanceOf(SchemaOutOfDateError);
      expect((error as SchemaOutOfDateError).missingVersions).toEqual(MIGRATIONS.map((m) => m.version));
    } finally {
      await admin.query("rename table schema_migrations_hidden to schema_migrations");
    }
  });

  it("warns about, but accepts, versions the code does not know", async () => {
    await closePool();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await admin.query("insert into schema_migrations (version) values ('999_from_a_newer_branch')");
    try {
      const conn = await connectMySQL();
      await conn.end();
      expect(warn.mock.calls.flat().join(" ")).toContain("999_from_a_newer_branch");
    } finally {
      await admin.query("delete from schema_migrations where version = '999_from_a_newer_branch'");
      warn.mockRestore();
    }
  });
});
