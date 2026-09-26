import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { RegisterGuestUseCase } from "../../src/application/useCase/registerGuestUseCase";
import { CreateLocalGameUseCase } from "../../src/application/useCase/createLocalGameUseCase";
import { FindLastGameUseCase } from "../../src/application/useCase/findLastGamesUseCase";
import { FindGameStateUseCase } from "../../src/application/useCase/findGameStateUseCase";
import { RegisterMoveUseCase } from "../../src/application/useCase/registerMoveUseCase";
import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../../src/infrastructure/repository/turn/turnMYSQLRepository";
import { GameResultMYSQLRepository } from "../../src/infrastructure/repository/gameResult/gameResultMYSQLRepository";
import { GameSeatsMYSQLRepository } from "../../src/infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
import { PlayerMYSQLRepository } from "../../src/infrastructure/repository/player/playerMYSQLRepository";
import { FindLastGameMySQLQueryService } from "../../src/infrastructure/query/findLastGamesMYSQLQueryService";
import { LatestTurnMySQLQueryService } from "../../src/infrastructure/query/latestTurnMYSQLQueryService";
import { RateLimitMySQLQueryService } from "../../src/infrastructure/query/rateLimitMYSQLQueryService";
import { TurnRepository } from "../../src/domain/model/turn/turnRepository";
import { Turn } from "../../src/domain/model/turn/turn";
import { Disc } from "../../src/domain/model/turn/disc";
import { Point } from "../../src/domain/model/turn/point";
import {
  activeTransactionCount,
  adminConnection,
  connectionIdOf,
  waitUntilDisconnected,
} from "./helpers";

// These tests run with DB_POOL_MAX=1 (see vitest.config.ts): if any path
// fails to return its connection, the next acquire waits forever and the
// test times out.

// A fixed client-IP hash, distinct from the one HTTP tests produce, so the
// per-IP guest cap is never shared with other test files.
const TEST_IP_HASH = createHash("sha256").update("connection.test").digest();

let admin: mysql.Connection;
let playerId: number;

beforeAll(async () => {
  admin = await adminConnection();
  const registerGuest = new RegisterGuestUseCase(
    new PlayerMYSQLRepository(),
    new RateLimitMySQLQueryService(),
  );
  playerId = (await registerGuest.run(TEST_IP_HASH)).player.id;
});

afterAll(async () => {
  await closePool();
  await admin.end();
});

describe("connectMySQL", () => {
  it("returns every connection to the pool across a sequence of use cases", async () => {
    const createLocalGame = new CreateLocalGameUseCase(
      new GameMYSQLRepository(),
      new TurnMYSQLRepository(),
      new GameSeatsMYSQLRepository(),
      new PlayerMYSQLRepository(),
      new RateLimitMySQLQueryService(),
    );
    const findLastGames = new FindLastGameUseCase(new FindLastGameMySQLQueryService());
    const findGameState = new FindGameStateUseCase(
      new TurnMYSQLRepository(),
      new GameResultMYSQLRepository(),
      new GameSeatsMYSQLRepository(),
      new LatestTurnMySQLQueryService(),
    );
    const registerMove = new RegisterMoveUseCase(
      new TurnMYSQLRepository(),
      new GameResultMYSQLRepository(),
      new GameSeatsMYSQLRepository(),
      new LatestTurnMySQLQueryService(),
    );

    await createLocalGame.run(playerId);
    await createLocalGame.run(playerId);
    const gameId = await createLocalGame.run(playerId);
    expect((await findLastGames.run(playerId)).length).toBeGreaterThanOrEqual(3);
    expect((await findGameState.run(gameId, playerId)).nextDisc).toBe(Disc.Dark);

    // A legal opening move for black: flips the white disc at (4, 3).
    await registerMove.run(gameId, playerId, 1, new Point(4, 2));

    const afterMove = await findGameState.run(gameId, playerId);
    expect(afterMove.board[2][4]).toBe(Disc.Dark);
    expect(afterMove.nextDisc).toBe(Disc.Light);
  });

  it("rolls back a transaction left open by an error before reusing the connection", async () => {
    const observed: { connectionId?: number; gameId?: number; activeInside?: number } = {};

    // Fails after CreateLocalGameUseCase has begun its transaction and inserted
    // the game row, recording what it saw on the way.
    const failingTurnRepository: TurnRepository = {
      async findForGmaeIdAndTurnCOunt(): Promise<Turn> {
        throw new Error("not used");
      },
      async save(conn: mysql.Connection, turn: Turn): Promise<void> {
        observed.connectionId = await connectionIdOf(conn);
        observed.gameId = turn.gameId;
        observed.activeInside = await activeTransactionCount(admin, observed.connectionId);
        throw new Error("simulated failure after beginTransaction");
      },
    };

    await expect(
      new CreateLocalGameUseCase(
        new GameMYSQLRepository(),
        failingTurnRepository,
        new GameSeatsMYSQLRepository(),
        new PlayerMYSQLRepository(),
        new RateLimitMySQLQueryService(),
      ).run(playerId),
    ).rejects.toThrow("simulated failure after beginTransaction");

    // The probe must see the open transaction, or the checks below prove nothing.
    expect(observed.activeInside).toBe(1);

    const next = await connectMySQL();
    try {
      expect(await connectionIdOf(next)).toBe(observed.connectionId);
      expect(await activeTransactionCount(admin, observed.connectionId!)).toBe(0);

      const [rows] = await next.query<mysql.RowDataPacket[]>(
        "select count(*) as n from games where id = ?",
        [observed.gameId],
      );
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await next.end();
    }
  });

  it("drops a connection that died instead of returning it to the pool", async () => {
    const conn = await connectMySQL();
    const deadId = await connectionIdOf(conn);

    await admin.query("kill ?", [deadId]);
    await waitUntilDisconnected(admin, deadId);

    await conn.end();

    const next = await connectMySQL();
    try {
      expect(await connectionIdOf(next)).not.toBe(deadId);
    } finally {
      await next.end();
    }
  });
});
