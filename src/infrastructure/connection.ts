import mysql from "mysql2/promise";
import { attachDatabasePool } from "@vercel/functions";
import { IDLE_TIMEOUT_MS, loadDbConfig } from "./dbConfig";
import { MIGRATIONS } from "./migration/migrations";
import { checkSchema } from "./migration/schemaCheck";

// mysql2 looks for idle connections once per second, so a connection can stay
// open up to this much longer than IDLE_TIMEOUT_MS.
const IDLE_CHECK_INTERVAL_MS = 1000;

let pool: mysql.Pool | undefined;

// Set once the schema check has passed for the current pool. A failed check
// is not remembered, so an instance recovers as soon as migrations are applied.
let schemaVerified = false;

// Created on first use so that a configuration error fails the request (and is
// logged) instead of crashing the function while the module loads.
function getPool(): mysql.Pool {
  if (!pool) {
    const created = mysql.createPool(loadDbConfig(process.env));

    // Keeps a Vercel function instance alive until its idle connections are
    // closed, so a suspended instance never holds database connections.
    // @vercel/functions does not read mysql2's idleTimeout from the pool (it
    // would fall back to 60 s), so it is given the release event and the real
    // timeout through the duck-typed interface it accepts.
    attachDatabasePool({
      on: (event: "release", listener: (...args: any[]) => void) => {
        created.pool.on(event, listener);
      },
      config: { idleTimeout: IDLE_TIMEOUT_MS + IDLE_CHECK_INTERVAL_MS },
    });

    pool = created;
  }
  return pool;
}

/**
 * Returns a pooled connection. Callers release it with `await conn.end()`,
 * which rolls back any transaction an error path left open (so the next
 * request cannot inherit it) and then returns the connection to the pool.
 *
 * The first successful call per pool also checks that the database has every
 * migration this code expects, and fails with SchemaOutOfDateError otherwise.
 */
export async function connectMySQL(): Promise<mysql.Connection> {
  const conn = await getPool().getConnection();

  conn.end = async () => {
    try {
      await conn.rollback();
    } catch {
      // The connection is unusable (for example, the server closed it).
      // Destroying it frees the pool slot for a fresh connection.
      conn.destroy();
      return;
    }
    conn.release();
  };

  if (!schemaVerified) {
    try {
      await checkSchema(conn, MIGRATIONS);
    } catch (e) {
      await conn.end();
      throw e;
    }
    schemaVerified = true;
  }

  return conn;
}

export async function closePool(): Promise<void> {
  schemaVerified = false;
  if (pool) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}
