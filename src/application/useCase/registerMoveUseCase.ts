import { connectMySQL } from "../../infrastructure/connection";
import { Point } from "../../domain/model/turn/point";
import { TurnRepository } from "../../domain/model/turn/turnRepository";
import { GameResult } from "../../domain/model/gameResult/gameResult";
import { GameResultRepository } from "../../domain/model/gameResult/gameResultRepository";
import { WinnerDisc } from "../../domain/model/gameResult/winnerDisc";
import { GameSeatsRepository } from "../../domain/model/gamePlayer/gameSeatsRepository";
import { ApplicationError } from "../error/applicationError";
import { LatestTurnQueryService } from "../query/latestTurnQueryService";
import { GameStateOutput, gameNotFound, toGameState } from "./findGameStateUseCase";

export class RegisterMoveUseCase {
  constructor(
    private _turnRepository: TurnRepository,
    private _gameResultRepository: GameResultRepository,
    private _gameSeatsRepository: GameSeatsRepository,
    private _latestTurnQuery: LatestTurnQueryService,
  ) {}

  /**
   * Plays `point` for whoever's colour is next, if that is this player.
   * `turnCount` is the turn this move creates (latest + 1), so a move made
   * from an out-of-date board is rejected instead of applied.
   */
  async run(
    gameId: number,
    playerId: number,
    turnCount: number,
    point: Point,
  ): Promise<GameStateOutput> {
    const conn = await connectMySQL();
    try {
      await conn.beginTransaction();

      // Must be the first statement: concurrent moves on this game queue on
      // these row locks, and each later one then reads what the earlier one
      // committed.
      const seats = await this._gameSeatsRepository.findForGameId(conn, gameId, { forUpdate: true });
      if (!seats || !seats.isParticipant(playerId)) {
        throw gameNotFound();
      }

      const latest = await this._latestTurnQuery.findLatestTurnCount(conn, gameId);
      if (latest === undefined) {
        throw new Error(`Game ${gameId} has seats but no turns`);
      }
      const turn = await this._turnRepository.findForGmaeIdAndTurnCOunt(conn, gameId, latest);

      const nextDisc = turn.nextDisc;
      if (nextDisc === undefined) {
        throw new ApplicationError("GameAlreadyEnded", "The game has already ended");
      }
      if (turnCount !== latest + 1) {
        throw new ApplicationError("StaleTurn", `This move is for turn ${turnCount}, but the next turn is ${latest + 1}`);
      }
      if (!seats.mayMove(playerId, nextDisc)) {
        throw new ApplicationError("NotYourTurn", "It is not your turn");
      }

      // Illegal moves throw the existing DomainErrors (400).
      const newTurn = turn.placeNext(nextDisc, point);
      try {
        await this._turnRepository.save(conn, newTurn);
      } catch (e) {
        // unique (game_id, turn_count) is a backstop behind the row lock.
        if ((e as { code?: unknown }).code === "ER_DUP_ENTRY") {
          throw new ApplicationError("StaleTurn", "Another move was made first");
        }
        throw e;
      }

      let winnerDisc: WinnerDisc | undefined;
      if (newTurn.gameEnded()) {
        winnerDisc = newTurn.winnerDisc();
        await this._gameResultRepository.save(conn, new GameResult(gameId, winnerDisc, newTurn.endAt));
      }

      await conn.commit();
      return toGameState(newTurn, seats, playerId, winnerDisc);
    } finally {
      await conn.end();
    }
  }
}
