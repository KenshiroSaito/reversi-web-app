import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { RegisterGuestUseCase } from "../../src/application/useCase/registerGuestUseCase";
import { CreateLocalGameUseCase, GAMES_PER_PLAYER_PER_HOUR } from "../../src/application/useCase/createLocalGameUseCase";
import { FindGameStateUseCase } from "../../src/application/useCase/findGameStateUseCase";
import { RegisterMoveUseCase } from "../../src/application/useCase/registerMoveUseCase";
import { ApplicationError, ApplicationErrorType } from "../../src/application/error/applicationError";
import { DomainError } from "../../src/domain/error/domainError";
import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../../src/infrastructure/repository/turn/turnMYSQLRepository";
import { GameResultMYSQLRepository } from "../../src/infrastructure/repository/gameResult/gameResultMYSQLRepository";
import { GameSeatsMYSQLRepository } from "../../src/infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
import { PlayerMYSQLRepository } from "../../src/infrastructure/repository/player/playerMYSQLRepository";
import { LatestTurnMySQLQueryService } from "../../src/infrastructure/query/latestTurnMYSQLQueryService";
import { RateLimitMySQLQueryService } from "../../src/infrastructure/query/rateLimitMYSQLQueryService";
import { GameSeats } from "../../src/domain/model/gamePlayer/gameSeats";
import { Game } from "../../src/domain/model/game/game";
import { Turn } from "../../src/domain/model/turn/turn";
import { Board } from "../../src/domain/model/turn/board";
import { Disc } from "../../src/domain/model/turn/disc";
import { Point } from "../../src/domain/model/turn/point";
import { WinnerDisc } from "../../src/domain/model/gameResult/winnerDisc";
import { adminConnection } from "./helpers";

const registerGuest = new RegisterGuestUseCase(new PlayerMYSQLRepository(), new RateLimitMySQLQueryService());
const createLocalGame = new CreateLocalGameUseCase(
  new GameMYSQLRepository(),
  new TurnMYSQLRepository(),
  new GameSeatsMYSQLRepository(),
  new PlayerMYSQLRepository(),
  new RateLimitMySQLQueryService(),
);
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

let admin: mysql.Connection;

beforeAll(async () => {
  // Two connections, so two moves can really run at the same time below.
  vi.stubEnv("DB_POOL_MAX", "2");
  admin = await adminConnection();
  await admin.query("use reversi_test");
});

afterAll(async () => {
  await closePool();
  await admin.end();
  vi.unstubAllEnvs();
});

const newPlayer = async () => (await registerGuest.run(randomBytes(32))).player.id;

async function expectApplicationError(promise: Promise<unknown>, type: ApplicationErrorType) {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(ApplicationError);
  expect((error as ApplicationError).type).toBe(type);
}

const E = Disc.Emoty;
const D = Disc.Dark;
const L = Disc.Light;

describe("CreateLocalGameUseCase", () => {
  it("creates a game with the player on both colours at turn 0", async () => {
    const playerId = await newPlayer();

    const gameId = await createLocalGame.run(playerId);
    const state = await findGameState.run(gameId, playerId);

    expect(state).toMatchObject({ gameId, turnCount: 0, nextDisc: Disc.Dark, winnerDisc: undefined });
    expect(state.yourDiscs).toEqual([Disc.Dark, Disc.Light]);
  });

  it(`refuses game ${GAMES_PER_PLAYER_PER_HOUR + 1} within an hour, and forgets older games`, async () => {
    const playerId = await newPlayer();
    for (let i = 0; i < GAMES_PER_PLAYER_PER_HOUR; i++) {
      await createLocalGame.run(playerId);
    }

    await expectApplicationError(createLocalGame.run(playerId), "GameCreationLimitReached");

    await admin.execute(
      "update game_players set created_at = current_timestamp(3) - interval 2 hour where player_id = ?",
      [playerId],
    );
    await expect(createLocalGame.run(playerId)).resolves.toBeGreaterThan(0);
  });
});

describe("FindGameStateUseCase", () => {
  it("hides a game from other players, unknown IDs, and games without seats", async () => {
    const owner = await newPlayer();
    const stranger = await newPlayer();
    const gameId = await createLocalGame.run(owner);

    const conn = await connectMySQL();
    let seatlessGameId: number;
    try {
      seatlessGameId = (await new GameMYSQLRepository().save(conn, new Game(undefined, new Date()))).id!;
    } finally {
      await conn.end();
    }

    await expectApplicationError(findGameState.run(gameId, stranger), "GameNotFound");
    await expectApplicationError(findGameState.run(2147483647, owner), "GameNotFound");
    await expectApplicationError(findGameState.run(seatlessGameId, owner), "GameNotFound");
  });
});

describe("RegisterMoveUseCase", () => {
  it("applies a legal move and returns the new state", async () => {
    const playerId = await newPlayer();
    const gameId = await createLocalGame.run(playerId);

    const state = await registerMove.run(gameId, playerId, 1, new Point(4, 2));

    expect(state.turnCount).toBe(1);
    expect(state.board[2][4]).toBe(Disc.Dark);
    expect(state.board[3][4]).toBe(Disc.Dark);
    expect(state.nextDisc).toBe(Disc.Light);
  });

  it("rejects an illegal move with the existing DomainError", async () => {
    const playerId = await newPlayer();
    const gameId = await createLocalGame.run(playerId);

    await expect(registerMove.run(gameId, playerId, 1, new Point(3, 3))).rejects.toBeInstanceOf(DomainError);
    await expect(registerMove.run(gameId, playerId, 1, new Point(0, 0))).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a stale turn count and a non-participant", async () => {
    const playerId = await newPlayer();
    const stranger = await newPlayer();
    const gameId = await createLocalGame.run(playerId);

    await expectApplicationError(registerMove.run(gameId, playerId, 5, new Point(4, 2)), "StaleTurn");
    await expectApplicationError(registerMove.run(gameId, stranger, 1, new Point(4, 2)), "GameNotFound");
  });

  it("rejects a move by the player not on the colour to move", async () => {
    const black = await newPlayer();
    const white = await newPlayer();
    const conn = await connectMySQL();
    let gameId: number;
    try {
      await conn.beginTransaction();
      gameId = (await new GameMYSQLRepository().save(conn, new Game(undefined, new Date()))).id!;
      await new TurnMYSQLRepository().save(
        conn,
        new Turn(gameId, 0, Disc.Dark, undefined, new Board(initialDiscs()), new Date()),
      );
      await new GameSeatsMYSQLRepository().save(
        conn,
        new GameSeats(gameId, [
          { disc: Disc.Dark, playerId: black },
          { disc: Disc.Light, playerId: white },
        ]),
      );
      await conn.commit();
    } finally {
      await conn.end();
    }

    await expectApplicationError(registerMove.run(gameId, white, 1, new Point(4, 2)), "NotYourTurn");
    await expect(registerMove.run(gameId, black, 1, new Point(4, 2))).resolves.toMatchObject({ turnCount: 1 });
  });

  it("finishes the game atomically on its last move, then refuses further moves", async () => {
    const playerId = await newPlayer();
    const gameId = await createLocalGame.run(playerId);
    // Turn 1: every square black except (0, 0) empty and (1, 0) white, black to move.
    // Black at (0, 0) flips (1, 0) and fills the board, ending the game.
    const discs = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => D as Disc));
    discs[0][0] = E;
    discs[0][1] = L;
    const conn = await connectMySQL();
    try {
      await new TurnMYSQLRepository().save(
        conn,
        new Turn(gameId, 1, Disc.Dark, undefined, new Board(discs), new Date()),
      );
    } finally {
      await conn.end();
    }

    const state = await registerMove.run(gameId, playerId, 2, new Point(0, 0));

    expect(state.nextDisc).toBeUndefined();
    expect(state.winnerDisc).toBe(WinnerDisc.Dark);
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      "select winner_disc from game_results where game_id = ?",
      [gameId],
    );
    expect(rows.map((r) => r.winner_disc)).toEqual([WinnerDisc.Dark]);
    await expectApplicationError(registerMove.run(gameId, playerId, 3, new Point(0, 0)), "GameAlreadyEnded");
    expect((await findGameState.run(gameId, playerId)).winnerDisc).toBe(WinnerDisc.Dark);
  });

  it("accepts exactly one of two identical moves sent at the same time", async () => {
    const playerId = await newPlayer();
    const gameId = await createLocalGame.run(playerId);

    const results = await Promise.allSettled([
      registerMove.run(gameId, playerId, 1, new Point(4, 2)),
      registerMove.run(gameId, playerId, 1, new Point(4, 2)),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ApplicationError);
    expect((rejected.reason as ApplicationError).type).toBe("StaleTurn");
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      "select count(*) as n from turns where game_id = ?",
      [gameId],
    );
    expect(Number(rows[0].n)).toBe(2);
  });
});

function initialDiscs(): Disc[][] {
  const discs = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => E as Disc));
  discs[3][3] = D;
  discs[3][4] = L;
  discs[4][3] = L;
  discs[4][4] = D;
  return discs;
}
