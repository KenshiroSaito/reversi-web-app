import mysql from "mysql2/promise";
import { Player } from "../../../application/identity/player";
import { PlayerRepository } from "../../../application/identity/playerRepository";
import { PlayerGateway } from "./playerGateway";

const playerGateway = new PlayerGateway();

export class PlayerMYSQLRepository implements PlayerRepository {
  async findByTokenHash(conn: mysql.Connection, tokenHash: Buffer): Promise<Player | undefined> {
    const record = await playerGateway.findByTokenHash(conn, tokenHash);
    if (!record) {
      return undefined;
    }
    return { id: record.id, displayName: record.displayName };
  }

  async insert(
    conn: mysql.Connection,
    tokenHash: Buffer,
    displayName: string,
    createdIpHash: Buffer,
  ): Promise<Player> {
    const record = await playerGateway.insert(conn, tokenHash, displayName, createdIpHash);
    return { id: record.id, displayName: record.displayName };
  }

  async lockForUpdate(conn: mysql.Connection, playerId: number) {
    // Players are never deleted, and callers only pass IDs they just resolved.
    if (!(await playerGateway.lockForUpdate(conn, playerId))) {
      throw new Error(`Player ${playerId} does not exist`);
    }
  }
}
