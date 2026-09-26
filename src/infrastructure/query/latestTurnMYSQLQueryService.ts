import mysql from "mysql2/promise";
import { LatestTurnQueryService } from "../../application/query/latestTurnQueryService";

export class LatestTurnMySQLQueryService implements LatestTurnQueryService {
  async findLatestTurnCount(conn: mysql.Connection, gameId: number): Promise<number | undefined> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "select max(turn_count) as latest from turns where game_id = ?",
      [gameId],
    );
    const latest = rows[0].latest;
    return latest === null ? undefined : Number(latest);
  }
}
