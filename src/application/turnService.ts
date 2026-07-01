import { connectMySQL } from "../infrastructure/connection";
import { GameRepository } from "../domain/game/gameRepository";
import { toDisc } from "../domain/turn/disc";
import { Point } from "../domain/turn/point";
import { TurnRepository } from "../domain/turn/turnRepository";

const turnRepository = new TurnRepository();
const gameRepository = new GameRepository();

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
        throw new Error("Latest game not found");
      }

      if (!game.id) {
        throw new Error("game.id does not exist");
      }

      const turn = await turnRepository.findForGmaeIdAndTurnCOunt(
        conn,
        game.id,
        turnCount,
      );

      return new findLatestGameTurnByTurnCountOutput(
        turnCount,
        turn.board.discs,
        turn.nextDisc,
        // TODO: If the match has been settled, retrieve the data from the `game_results` table
        null,
      );
    } finally {
      await conn.end();
    }
  }

  async registerTurn(turnCount: number, disc: number, x: number, y: number) {
    const conn = await connectMySQL();

    try {
      // Get the previous turn
      const game = await gameRepository.findLatest(conn);
      if (!game) {
        throw new Error("Latest game not found");
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

      // Place a stone
      const newTurn = previousTurn.placeNext(toDisc(disc), new Point(x, y));

      // Save the turn
      await turnRepository.save(conn, newTurn);

      await conn.commit();
    } finally {
      await conn.end();
    }
  }
}
