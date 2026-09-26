import mysql from "mysql2/promise";
import { GameSeatRecord } from "./gameSeatRecord";

export class GameSeatGateway {
  async findForGameId(
    conn: mysql.Connection,
    gameId: number,
    forUpdate: boolean,
  ): Promise<GameSeatRecord[]> {
    const sql =
      "select game_id, disc, player_id from game_players where game_id = ? order by disc" +
      (forUpdate ? " for update" : "");
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, [gameId]);

    return rows.map((r) => new GameSeatRecord(r["game_id"], r["disc"], r["player_id"]));
  }

  /** One multi-row insert, so a game never ends up with only some of its seats. */
  async insertAll(
    conn: mysql.Connection,
    gameId: number,
    seats: readonly { disc: number; playerId: number }[],
  ) {
    const sql =
      "insert into game_players (game_id, disc, player_id) values " +
      seats.map(() => "(?, ?, ?)").join(", ");
    const values = seats.flatMap((seat) => [gameId, seat.disc, seat.playerId]);

    await conn.execute(sql, values);
  }
}
