import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/infrastructure/migration/migrations";
import { appliedVersions, applyPendingMigrations } from "../../src/infrastructure/migration/migrationRunner";
import { adminConnection } from "./helpers";

let admin: mysql.Connection;

beforeAll(async () => {
  admin = await adminConnection();
  await admin.query("use reversi_test");
});

afterAll(async () => {
  await admin.end();
});

describe("migrations in reversi_test", () => {
  it("records every migration", async () => {
    expect(await appliedVersions(admin)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("applies nothing when run again", async () => {
    expect(await applyPendingMigrations(admin, MIGRATIONS)).toEqual([]);
  });

  it("creates the Phase 1 tables", async () => {
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      "select table_name as name from information_schema.tables where table_schema = 'reversi_test'",
    );
    const names = rows.map((r) => String(r.name));
    expect(names).toEqual(expect.arrayContaining(["players", "game_players", "schema_migrations"]));
  });
});
