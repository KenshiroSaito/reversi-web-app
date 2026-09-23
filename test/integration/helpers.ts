import mysql from "mysql2/promise";

/** A root connection outside the application pool, for inspecting server state. */
export async function adminConnection(): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: "root",
    password: process.env.DB_ROOT_PASSWORD,
    multipleStatements: true,
  });
}

export async function connectionIdOf(conn: mysql.Connection): Promise<number> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>("select connection_id() as id");
  return Number(rows[0].id);
}

/**
 * Number of open transactions on the given server connection (0 or 1).
 * performance_schema is used because information_schema.innodb_trx is cached
 * and can lag behind the real transaction state.
 */
export async function activeTransactionCount(
  admin: mysql.Connection,
  connectionId: number,
): Promise<number> {
  const [rows] = await admin.query<mysql.RowDataPacket[]>(
    `select count(*) as n
       from performance_schema.events_transactions_current t
       join performance_schema.threads th on th.thread_id = t.thread_id
      where th.processlist_id = ? and t.state = 'ACTIVE'`,
    [connectionId],
  );
  return Number(rows[0].n);
}

export async function waitUntilDisconnected(
  admin: mysql.Connection,
  connectionId: number,
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      "select count(*) as n from performance_schema.threads where processlist_id = ?",
      [connectionId],
    );
    if (Number(rows[0].n) === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Connection ${connectionId} is still open`);
}
