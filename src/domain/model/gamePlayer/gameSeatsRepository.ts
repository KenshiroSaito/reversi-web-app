import mysql from "mysql2/promise";
import { GameSeats } from "./gameSeats";

export interface GameSeatsRepository {
  /** Undefined when the game has no seats (a pre-Phase-1 game, or no such game). */
  findForGameId(
    conn: mysql.Connection,
    gameId: number,
    options?: { forUpdate: boolean },
  ): Promise<GameSeats | undefined>;

  save(conn: mysql.Connection, seats: GameSeats): Promise<void>;
}
