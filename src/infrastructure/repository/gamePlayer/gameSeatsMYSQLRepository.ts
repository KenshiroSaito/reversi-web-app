import mysql from "mysql2/promise";
import { GameSeats } from "../../../domain/model/gamePlayer/gameSeats";
import { GameSeatsRepository } from "../../../domain/model/gamePlayer/gameSeatsRepository";
import { toDisc } from "../../../domain/model/turn/disc";
import { GameSeatGateway } from "./gameSeatGateway";

const gameSeatGateway = new GameSeatGateway();

export class GameSeatsMYSQLRepository implements GameSeatsRepository {
  async findForGameId(
    conn: mysql.Connection,
    gameId: number,
    options: { forUpdate: boolean } = { forUpdate: false },
  ): Promise<GameSeats | undefined> {
    const records = await gameSeatGateway.findForGameId(conn, gameId, options.forUpdate);

    // No rows: a game created before Phase 1, or no such game. Callers treat
    // both as "not found"; GameSeats is never built from an empty set.
    if (records.length === 0) {
      return undefined;
    }

    return new GameSeats(
      gameId,
      records.map((r) => ({ disc: toDisc(r.disc), playerId: r.playerId })),
    );
  }

  async save(conn: mysql.Connection, seats: GameSeats) {
    await gameSeatGateway.insertAll(conn, seats.gameId, seats.seats);
  }
}
