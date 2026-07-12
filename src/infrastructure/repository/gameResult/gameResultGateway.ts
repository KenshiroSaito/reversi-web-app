import { GameResultRecord } from "./gameResultRecord";
import mysql from "mysql2/promise";

export class GameResultGateway {
  async findForGameId(
    conn: mysql.Connection,
    gameId: number,
  ): Promise<GameResultRecord | undefined> {
    const gameSelectResult = await conn.execute<mysql.RowDataPacket[]>(
      "select id, game_id, winner_disc, end_at from game_results where game_id = ?",
      [gameId],
    );
    const record = gameSelectResult[0][0];

    if (!record) {
      return undefined;
    }

    return new GameResultRecord(
      record["id"],
      record["game_id"],
      record["winner_disc"],
      record["end_at"],
    );
  }

  async insert(
    conn: mysql.Connection,
    gameId: number,
    winnerDisc: number,
    endAt: Date,
  ) {
    await conn.execute(
      "insert into game_results (game_id, winner_disc, end_at) values (?, ?, ?)",
      [gameId, winnerDisc, endAt],
    );
  }
}
