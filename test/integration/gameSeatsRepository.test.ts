import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { GameSeatsMYSQLRepository } from "../../src/infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
import { GameSeats } from "../../src/domain/model/gamePlayer/gameSeats";
import { Game } from "../../src/domain/model/game/game";
import { Disc } from "../../src/domain/model/turn/disc";

const repository = new GameSeatsMYSQLRepository();
let conn: mysql.Connection;

async function insertPlayer(): Promise<number> {
  const [result] = await conn.execute<mysql.ResultSetHeader>(
    "insert into players (token_hash, display_name) values (?, 'Guest 1000')",
    [randomBytes(32)],
  );
  return result.insertId;
}

async function insertGame(): Promise<number> {
  const game = await new GameMYSQLRepository().save(conn, new Game(undefined, new Date()));
  return game.id!;
}

beforeEach(async () => {
  conn = await connectMySQL();
});

afterEach(async () => {
  await conn.end();
});

afterAll(async () => {
  await closePool();
});

describe("GameSeatsMYSQLRepository", () => {
  it("saves and reads back a local game's seats", async () => {
    const playerId = await insertPlayer();
    const gameId = await insertGame();

    await repository.save(conn, GameSeats.forLocalGame(gameId, playerId));
    const seats = await repository.findForGameId(conn, gameId);

    expect(seats?.discsOf(playerId)).toEqual([Disc.Dark, Disc.Light]);
  });

  it("reads seats with a row lock inside a transaction", async () => {
    const playerId = await insertPlayer();
    const gameId = await insertGame();
    await repository.save(conn, GameSeats.forLocalGame(gameId, playerId));

    await conn.beginTransaction();
    const seats = await repository.findForGameId(conn, gameId, { forUpdate: true });
    await conn.rollback();

    expect(seats?.isParticipant(playerId)).toBe(true);
  });

  it("returns undefined for a game without seats and for an unknown game", async () => {
    const gameId = await insertGame();

    expect(await repository.findForGameId(conn, gameId)).toBeUndefined();
    expect(await repository.findForGameId(conn, 2147483647)).toBeUndefined();
  });

  it("rejects a game with a single seat as a server fault", async () => {
    const playerId = await insertPlayer();
    const gameId = await insertGame();
    await conn.execute("insert into game_players (game_id, disc, player_id) values (?, 1, ?)", [
      gameId,
      playerId,
    ]);

    await expect(repository.findForGameId(conn, gameId)).rejects.toThrow("exactly one seat");
  });
});
