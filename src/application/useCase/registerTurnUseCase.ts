import { connectMySQL } from "../../infrastructure/connection";
import { Disc } from "../../domain/model/turn/disc";
import { Point } from "../../domain/model/turn/point";
import { ApplicationError } from "../error/applicationError";
import { GameResult } from "../../domain/model/gameResult/gameResult";
import { TurnRepository } from "../../domain/model/turn/turnRepository";
import { GameRepository } from "../../domain/model/game/gameRepository";
import { GameResultRepository } from "../../domain/model/gameResult/gameResultRepository";

export class RegisterTurnUseCase {
  constructor(
    private _turnRepository: TurnRepository,
    private _gameRepository: GameRepository,
    private _gameResultRepository: GameResultRepository,
  ) {}
  async run(turnCount: number, disc: Disc, point: Point) {
    const conn = await connectMySQL();
    try {
      const game = await this._gameRepository.findLatest(conn);
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
      const previousTurn = await this._turnRepository.findForGmaeIdAndTurnCOunt(
        conn,
        game.id,
        previousTurnCount,
      );

      const newTurn = previousTurn.placeNext(disc, point);

      await this._turnRepository.save(conn, newTurn);

      if (newTurn.gameEnded()) {
        const winnerDisc = newTurn.winnerDisc();
        const gameResult = new GameResult(game.id, winnerDisc, newTurn.endAt);
        await this._gameResultRepository.save(conn, gameResult);
      }

      await conn.commit();
    } finally {
      await conn.end();
    }
  }
}
