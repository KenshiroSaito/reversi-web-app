import { connectMySQL } from "../../infrastructure/connection";
import { GameRepository } from "../../domain/model/game/gameRepository";
import { Disc } from "../../domain/model/turn/disc";
import { Point } from "../../domain/model/turn/point";
import { TurnRepository } from "../../domain/model/turn/turnRepository";
import { ApplicationError } from "../error/applicationError";
import { GameResultRepository } from "../../domain/model/gameResult/gameResultRepository";
import { GameResult } from "../../domain/model/gameResult/gameResult";

const turnRepository = new TurnRepository();
const gameRepository = new GameRepository();
const gameResultRepository = new GameResultRepository();

class findLatestGameTurnByTurnCountOutput {
  constructor(
    private _turnCount: number,
    private _board: number[][],
    private _nextDisc: number | undefined,
    private _winnerDisc: number | null,
  ) {}

  get turnCount() {
    return this._turnCount;
  }

  get board() {
    return this._board;
  }

  get nextDisc() {
    return this._nextDisc;
  }

  get winnerDisc() {
    return this._winnerDisc;
  }
}

export class TurnService {
  async findLatestGameTurnByTurnCount(
    turnCount: number,
  ): Promise<findLatestGameTurnByTurnCountOutput> {
    const conn = await connectMySQL();

    try {
      const game = await gameRepository.findLatest(conn);
      if (!game) {
        throw new ApplicationError(
          "LatestGameNotFound",
          "Latest game not found",
        );
      }

      if (!game.id) {
        throw new Error("game.id does not exist");
      }

      const turn = await turnRepository.findForGmaeIdAndTurnCOunt(
        conn,
        game.id,
        turnCount,
      );

      let gameResult: GameResult | undefined;
      if (turn.gameEnded()) {
        gameResult = await gameResultRepository.findForGameId(conn, game.id);
      }

      return new findLatestGameTurnByTurnCountOutput(
        turnCount,
        turn.board.discs,
        turn.nextDisc,
        gameResult?.winnerDisc ?? null,
      );
    } finally {
      await conn.end();
    }
  }

  async registerTurn(turnCount: number, disc: Disc, point: Point) {
    const conn = await connectMySQL();

    try {
      const game = await gameRepository.findLatest(conn);
      if (!game) {
        throw new ApplicationError(
          "LatestGameNotFound",
          "Latest game not found",
        );
      }

      if (!game.id) {
        throw new Error("game.id does not exist");
      }

      const previousTurnCount = turnCount - 1;
      const previousTurn = await turnRepository.findForGmaeIdAndTurnCOunt(
        conn,
        game.id,
        previousTurnCount,
      );

      const newTurn = previousTurn.placeNext(disc, point);

      await turnRepository.save(conn, newTurn);

      if (newTurn.gameEnded()) {
        const winnerDisc = newTurn.winnerDisc();
        const gameResult = new GameResult(game.id, winnerDisc, newTurn.endAt);
        await gameResultRepository.save(conn, gameResult);
      }

      await conn.commit();
    } finally {
      await conn.end();
    }
  }
}
