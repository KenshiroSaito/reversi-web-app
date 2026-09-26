import mysql from "mysql2/promise";
import { Migration } from "./migrations";
import { appliedVersions } from "./migrationRunner";

export class SchemaOutOfDateError extends Error {
  constructor(readonly missingVersions: string[]) {
    super(
      `Database schema is missing migrations: ${missingVersions.join(", ")}. ` +
        "Run `npm run migrate` against this database.",
    );
    this.name = "SchemaOutOfDateError";
  }
}

/**
 * Fails if the database lacks a migration this code expects. Versions the
 * code does not know (a newer branch migrated this database) only warn:
 * migrations are additive, so older code keeps working.
 */
export async function checkSchema(conn: mysql.Connection, migrations: Migration[]): Promise<void> {
  const applied = await appliedVersions(conn);
  const appliedSet = new Set(applied);
  const expected = migrations.map((m) => m.version);

  const missing = expected.filter((version) => !appliedSet.has(version));
  if (missing.length > 0) {
    throw new SchemaOutOfDateError(missing);
  }

  const unknown = applied.filter((version) => !expected.includes(version));
  if (unknown.length > 0) {
    console.warn(`Database has migrations this code does not know about: ${unknown.join(", ")}`);
  }
}
