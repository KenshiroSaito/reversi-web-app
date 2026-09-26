import mysql from "mysql2/promise";
import { PlayerRecord } from "./playerRecord";

export class PlayerGateway {
  async findByTokenHash(conn: mysql.Connection, tokenHash: Buffer): Promise<PlayerRecord | undefined> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "select id, display_name from players where token_hash = ?",
      [tokenHash],
    );
    const record = rows[0];
    if (!record) {
      return undefined;
    }
    return new PlayerRecord(record["id"], record["display_name"]);
  }

  async insert(
    conn: mysql.Connection,
    tokenHash: Buffer,
    displayName: string,
    createdIpHash: Buffer,
  ): Promise<PlayerRecord> {
    const [result] = await conn.execute<mysql.ResultSetHeader>(
      "insert into players (token_hash, display_name, created_ip_hash) values (?, ?, ?)",
      [tokenHash, displayName, createdIpHash],
    );
    return new PlayerRecord(result.insertId, displayName);
  }

  async lockForUpdate(conn: mysql.Connection, playerId: number): Promise<boolean> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "select id from players where id = ? for update",
      [playerId],
    );
    return rows.length > 0;
  }
}
