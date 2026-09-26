import mysql from "mysql2/promise";
import { Player } from "./player";

export interface PlayerRepository {
  findByTokenHash(conn: mysql.Connection, tokenHash: Buffer): Promise<Player | undefined>;

  insert(
    conn: mysql.Connection,
    tokenHash: Buffer,
    displayName: string,
    createdIpHash: Buffer,
  ): Promise<Player>;

  /** Locks the player's row for the rest of the transaction. */
  lockForUpdate(conn: mysql.Connection, playerId: number): Promise<void>;
}
