import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { StartNewGameUseCase } from "../../src/application/useCase/startNewGameUseCase";
import { FindLastGameUseCase } from "../../src/application/useCase/findLastGamesUseCase";
import { FindLatestGameTurnByTurnCountUseCase } from "../../src/application/useCase/findLatestGameTurnByTurnCountUseCase";
import { RegisterTurnUseCase } from "../../src/application/useCase/registerTurnUseCase";
import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../../src/infrastructure/repository/turn/turnMYSQLRepository";
import { GameResultMYSQLRepository } from "../../src/infrastructure/repository/gameResult/gameResultMYSQLRepository";
import { FindLastGameMySQLQueryService } from "../../src/infrastructure/query/findLastGamesMYSQLQueryService";
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

let admin: mysql.Connection;

beforeAll(async () => {
  admin = await adminConnection();
});

afterAll(async () => {
  await closePool();
  await admin.end();
});

describe("connectMySQL", () => {
  it("returns every connection to the pool across a sequence of use cases", async () => {
    const startNewGame = new StartNewGameUseCase(
      new GameMYSQLRepository(),
      new TurnMYSQLRepository(),
    );
    const findLastGames = new FindLastGameUseCase(new FindLastGameMySQLQueryService());
    const findTurn = new FindLatestGameTurnByTurnCountUseCase(
      new TurnMYSQLRepository(),
      new GameMYSQLRepository(),
      new GameResultMYSQLRepository(),
    );
    const registerTurn = new RegisterTurnUseCase(
      new TurnMYSQLRepository(),
      new GameMYSQLRepository(),
      new GameResultMYSQLRepository(),
    );

    await startNewGame.run();
    await startNewGame.run();
    await startNewGame.run();
    expect((await findLastGames.run()).length).toBeGreaterThanOrEqual(3);
    expect((await findTurn.run(0)).nextDisc).toBe(Disc.Dark);

    // A legal opening move for black: flips the white disc at (4, 3).
    await registerTurn.run(1, Disc.Dark, new Point(4, 2));

    const afterMove = await findTurn.run(1);
    expect(afterMove.board[2][4]).toBe(Disc.Dark);
    expect(afterMove.nextDisc).toBe(Disc.Light);
  });

  it("rolls back a transaction left open by an error before reusing the connection", async () => {
    const observed: { connectionId?: number; gameId?: number; activeInside?: number } = {};

    // Fails after StartNewGameUseCase has begun its transaction and inserted
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
      new StartNewGameUseCase(new GameMYSQLRepository(), failingTurnRepository).run(),
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
