import mysql from "mysql2/promise";
import { Migration } from "./migrations";

const LOCK_NAME = "reversi_schema_migrations";
const LOCK_TIMEOUT_SECONDS = 10;

const CREATE_SCHEMA_MIGRATIONS = `create table if not exists schema_migrations (
  version    varchar(64) primary key,
  applied_at datetime(3) not null default current_timestamp(3)
)`;

/** Versions recorded as applied; a database never migrated has none. */
export async function appliedVersions(conn: mysql.Connection): Promise<string[]> {
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "select version from schema_migrations order by version",
    );
    return rows.map((row) => String(row.version));
  } catch (e) {
    if ((e as { code?: unknown }).code === "ER_NO_SUCH_TABLE") {
      return [];
    }
    throw e;
  }
}

/**
 * Applies every migration not yet recorded, in order, and returns the versions
 * it applied. A named lock keeps two concurrent runs from interleaving.
 */
export async function applyPendingMigrations(
  conn: mysql.Connection,
  migrations: Migration[],
): Promise<string[]> {
  const [lockRows] = await conn.query<mysql.RowDataPacket[]>(
    "select get_lock(?, ?) as acquired",
    [LOCK_NAME, LOCK_TIMEOUT_SECONDS],
  );
  if (Number(lockRows[0].acquired) !== 1) {
    throw new Error("Another migration run is in progress (could not take the migration lock)");
  }

  try {
    await conn.query(CREATE_SCHEMA_MIGRATIONS);
    const applied = new Set(await appliedVersions(conn));

    const newlyApplied: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }
      for (const statement of migration.statements) {
        await conn.query(statement);
      }
      await conn.execute("insert into schema_migrations (version) values (?)", [migration.version]);
      newlyApplied.push(migration.version);
    }
    return newlyApplied;
  } finally {
    await conn.query("select release_lock(?)", [LOCK_NAME]);
  }
}
