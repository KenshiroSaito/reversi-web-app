import mysql from "mysql2/promise";

export interface LatestTurnQueryService {
  /** Undefined when the game has no turns. */
  findLatestTurnCount(conn: mysql.Connection, gameId: number): Promise<number | undefined>;
}
