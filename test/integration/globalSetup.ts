import { readFileSync } from "node:fs";
import { adminConnection } from "./helpers";

const TEST_DATABASE = "reversi_test";

// Statements in mysql/init.sql that target the development database by name.
const DATABASE_STATEMENT = /^(drop database|create database|use)\b/i;

/**
 * Rebuilds the test database from mysql/init.sql so the schema has a single
 * source of truth and every run starts empty.
 */
export default async function setup(): Promise<void> {
  const admin = await adminConnection();
  try {
    const statements = readFileSync("mysql/init.sql", "utf8")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement && !DATABASE_STATEMENT.test(statement));

    await admin.query(`drop database if exists ${TEST_DATABASE}`);
    await admin.query(`create database ${TEST_DATABASE}`);
    await admin.query(`grant all on ${TEST_DATABASE}.* to ?@'%'`, [process.env.DB_USER]);
    await admin.query(`use ${TEST_DATABASE}`);
    for (const statement of statements) {
      await admin.query(statement);
    }
  } finally {
    await admin.end();
  }
}
