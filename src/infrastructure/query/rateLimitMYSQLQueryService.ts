import mysql from "mysql2/promise";
import { RateLimitQueryService } from "../../application/query/rateLimitQueryService";

export class RateLimitMySQLQueryService implements RateLimitQueryService {
  async countGuestsCreatedInLastHour(conn: mysql.Connection, ipHash: Buffer): Promise<number> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `select count(*) as n from players
        where created_ip_hash = ? and created_at > current_timestamp(3) - interval 1 hour`,
      [ipHash],
    );
    return Number(rows[0].n);
  }

  async countGamesCreatedInLastHour(conn: mysql.Connection, playerId: number): Promise<number> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `select count(distinct game_id) as n from game_players
        where player_id = ? and created_at > current_timestamp(3) - interval 1 hour`,
      [playerId],
    );
    return Number(rows[0].n);
  }
}
