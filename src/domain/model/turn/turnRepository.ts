import { Turn } from "./turn";
import mysql from "mysql2/promise";

export interface TurnRepository {
  findForGmaeIdAndTurnCOunt(
    conn: mysql.Connection,
    gameId: number,
    turnCount: number,
  ): Promise<Turn>;
  save(conn: mysql.Connection, turn: Turn): Promise<void>;
}
